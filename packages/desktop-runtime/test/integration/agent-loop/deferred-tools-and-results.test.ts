import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { systemClock } from '../../../src/ports/clock.js';
import type {
  ToolExecutionContext,
  ToolHost,
} from '../../../src/ports/tool-host.js';
import { CapturingToolHost, mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop deferred tools and stored results', () => {
  it('does not execute a tool_search match until the next sampling step', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Deferred execution gate' });
    const modelClient = new SameStepDeferredModelClient();
    const toolHost = new DeferredShellToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'run the deferred command' });
    const saved = await threadStore.getThread(thread.id);
    const shellMessages = saved?.messages.filter((message) => (
      message.role === 'tool' && message.toolName === 'run_shell_command'
    )) ?? [];

    expect(modelClient.requests).toHaveLength(3);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name))
      .not.toContain('run_shell_command');
    expect(modelClient.requests[1].tools?.at(-1)?.name).toBe('run_shell_command');
    expect(toolHost.calls).toEqual([{ command: 'printf next-step' }]);
    expect(shellMessages).toHaveLength(2);
    expect(shellMessages[0]?.content).toContain('was not advertised in this sampling step');
    expect(shellMessages[1]?.content).toBe('next-step command output');
  });

  it('recovers a stored result page by page without re-truncating read_tool_result output', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Stored result pagination' });
    const original = '0123456789abcdef'.repeat(3_000);
    const toolResultStore = new FileToolResultStore(dataDir);
    await toolResultStore.save({
      resultId: 'tool_result_pagination',
      threadId: thread.id,
      toolCallId: 'call_original',
      toolName: 'run_shell_command',
      fullText: original,
      originalEstimatedTokens: 12_000,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    const modelClient = new PaginationRecoveryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new CapturingToolHost(),
      toolResultStore,
    });

    await loop.sendTurn(thread.id, { input: 'recover the whole stored result' });
    const saved = await threadStore.getThread(thread.id);
    const pages = saved?.messages.filter((message) => (
      message.role === 'tool' && message.toolName === 'read_tool_result'
    )) ?? [];

    expect(modelClient.requests).toHaveLength(3);
    expect(pages).toHaveLength(2);
    expect(pages.every((message) => !message.content.includes('Warning: tool output was truncated.'))).toBe(true);
    expect(pages.every((message) => message.toolResultRef === undefined)).toBe(true);
    expect(pages.map(pageContent).join('')).toBe(original);
  });
});

class SameStepDeferredModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_search_shell',
            name: 'tool_search',
            arguments: JSON.stringify({ query: 'shell command' }),
          },
          {
            id: 'call_shell_same_step',
            name: 'run_shell_command',
            arguments: JSON.stringify({ command: 'printf same-step' }),
          },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_next_step',
          name: 'run_shell_command',
          arguments: JSON.stringify({ command: 'printf next-step' }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Deferred command completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PaginationRecoveryModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    const previousPage = [...request.messages].reverse().find((message) => (
      message.role === 'tool' && message.toolName === 'read_tool_result'
    ));
    const nextOffset = previousPage?.content.match(/next_offset: (\d+)/u)?.[1];
    if (!previousPage || nextOffset) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_read_page_${this.requests.length}`,
          name: 'read_tool_result',
          arguments: JSON.stringify({
            result_id: 'tool_result_pagination',
            offset: nextOffset ? Number(nextOffset) : 0,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Stored result recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class DeferredShellToolHost implements ToolHost {
  readonly calls: Array<{ command: string }> = [];

  async listTools(): Promise<RuntimeToolDefinition[]> {
    return [{
      name: 'run_shell_command',
      description: 'Run a shell command.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }];
  }

  toolRuntimeProfile() {
    return { exposure: 'deferred' as const };
  }

  async runTool(_name: string, input: unknown, _context: ToolExecutionContext) {
    this.calls.push(input as { command: string });
    return { content: 'next-step command output' };
  }
}

function pageContent(message: { content: string }): string {
  const separator = message.content.indexOf('\n\n');
  return separator >= 0 ? message.content.slice(separator + 2) : '';
}
