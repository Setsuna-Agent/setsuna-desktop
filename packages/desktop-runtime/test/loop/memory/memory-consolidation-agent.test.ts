import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMemoryConsolidationAgent } from '../../../src/loop/memory/memory-consolidation-agent.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

describe('memory consolidation agent', () => {
  it('continues beyond the former tool-round cap while the rollout stays within its token budget', async () => {
    const root = await createMemoryRoot();
    const toolCallBatches = 13;
    const modelClient = new FiniteConsolidationModelClient(toolCallBatches);

    const result = await runMemoryConsolidationAgent({
      modelClient,
      model: 'background-memory-model',
      providerId: 'background-provider',
      root,
      now: fixedNow,
      rolloutTokenBudget: 1_000,
      deadlineMs: 2_000,
    });

    expect(result).toMatchObject({
      rounds: toolCallBatches + 1,
      usage: { inputTokens: 14, outputTokens: 14, totalTokens: 28 },
    });
    expect(modelClient.requests).toHaveLength(toolCallBatches + 1);
    expect(modelClient.requests.every((request) => request.model === 'background-memory-model')).toBe(true);
    expect(modelClient.requests.every((request) => request.providerId === 'background-provider')).toBe(true);
    expect(modelClient.requests.every((request) => request.toolChoice === 'auto')).toBe(true);
    expect(modelClient.requests.every((request) => request.tools?.some((tool) => tool.name === 'read_file'))).toBe(true);
  });

  it('fails explicitly when the cumulative token budget is exhausted during a tool chain', async () => {
    const root = await createMemoryRoot();
    const modelClient = new EndlessConsolidationModelClient();

    await expect(runMemoryConsolidationAgent({
      modelClient,
      root,
      now: fixedNow,
      rolloutTokenBudget: 8,
      deadlineMs: 2_000,
    })).rejects.toThrow('memory consolidation exhausted rollout token budget (8/8 tokens)');

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests.every((request) => request.tools?.length)).toBe(true);
    expect(modelClient.requests.every((request) => request.toolChoice !== 'none')).toBe(true);
  });

  it('rejects a final response sampled after the cumulative token budget is exhausted', async () => {
    const root = await createMemoryRoot();
    const modelClient = new FinalConsolidationModelClient();

    await expect(runMemoryConsolidationAgent({
      modelClient,
      root,
      now: fixedNow,
      rolloutTokenBudget: 8,
      deadlineMs: 2_000,
    })).rejects.toThrow('memory consolidation exhausted rollout token budget (8/8 tokens)');

    expect(modelClient.requests).toHaveLength(1);
  });

  it('uses the task deadline when a provider omits usage and does not finish', async () => {
    const root = await createMemoryRoot();
    const modelClient = new UsageFreeBlockingModelClient();

    await expect(runMemoryConsolidationAgent({
      modelClient,
      root,
      now: fixedNow,
      rolloutTokenBudget: 8,
      deadlineMs: 50,
    })).rejects.toThrow('memory consolidation exceeded 50ms deadline');

    expect(modelClient.requests).toHaveLength(1);
  });

  it('forwards an external cancellation before sampling', async () => {
    const root = await createMemoryRoot();
    const modelClient = new FiniteConsolidationModelClient(1);
    const controller = new AbortController();
    controller.abort(new Error('runtime shutdown'));

    await expect(runMemoryConsolidationAgent({
      modelClient,
      root,
      now: fixedNow,
      signal: controller.signal,
      deadlineMs: 2_000,
    })).rejects.toThrow('runtime shutdown');

    expect(modelClient.requests).toHaveLength(0);
  });
});

class FiniteConsolidationModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly toolCallBatches: number) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    if (this.requests.length > this.toolCallBatches) {
      yield { type: 'text_delta', text: 'Consolidation complete.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield {
      type: 'tool_calls',
      toolCalls: [{
        id: `read_${this.requests.length}`,
        name: 'read_file',
        arguments: '{"path":"MEMORY.md"}',
      }],
    };
    yield { type: 'done', finishReason: 'tool_calls' };
  }
}

class EndlessConsolidationModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } };
    yield {
      type: 'tool_calls',
      toolCalls: [{
        id: `read_${this.requests.length}`,
        name: 'read_file',
        arguments: '{"path":"MEMORY.md"}',
      }],
    };
    yield { type: 'done', finishReason: 'tool_calls' };
  }
}

class FinalConsolidationModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Consolidation complete.' };
    yield { type: 'usage', usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class UsageFreeBlockingModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    await new Promise<void>((_resolve, reject) => {
      const signal = request.signal;
      if (!signal) {
        reject(new Error('Expected a consolidation deadline signal.'));
        return;
      }
      const rejectWithAbortReason = () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('memory consolidation aborted'));
      };
      if (signal.aborted) {
        rejectWithAbortReason();
        return;
      }
      signal.addEventListener('abort', rejectWithAbortReason, { once: true });
    });
    yield { type: 'done', finishReason: 'stop' };
  }
}

async function createMemoryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-consolidation-'));
  await Promise.all([
    writeFile(path.join(root, 'MEMORY.md'), '# Memory\n', 'utf8'),
    writeFile(path.join(root, 'memory_summary.md'), 'v1\n', 'utf8'),
  ]);
  return root;
}

function fixedNow(): Date {
  return new Date('2026-07-14T00:00:00.000Z');
}
