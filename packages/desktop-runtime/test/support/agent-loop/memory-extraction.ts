import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

import {
  MemorySettingsConfigStore
} from './shared.js';

export class BlockingPassiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  passiveAborted = false;
  private passiveStartedResolve!: () => void;
  private readonly passiveStarted = new Promise<void>((resolve) => {
    this.passiveStartedResolve = resolve;
  });

  waitForPassiveStart(): Promise<void> {
    return this.passiveStarted;
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      this.passiveStartedResolve();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          this.passiveAborted = true;
          reject(request.signal?.reason instanceof Error ? request.signal.reason : new Error('aborted'));
        };
        if (request.signal?.aborted) onAbort();
        else request.signal?.addEventListener('abort', onAbort, { once: true });
      });
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class CodexStage1MemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
          rollout_summary: 'User prefers passive memory extraction to follow the selected model.',
          rollout_slug: 'memory-model-routing',
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              kind: 'preference',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ConsolidatingCodexMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private consolidationRounds = 0;

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
          rollout_summary: 'User prefers passive memory extraction to follow the selected model.',
          rollout_slug: 'memory-model-routing',
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              kind: 'preference',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (request.model === 'memory-consolidation') {
      this.consolidationRounds += 1;
      if (this.consolidationRounds === 1) {
        yield {
          type: 'tool_calls',
          toolCalls: [
            { id: 'phase2_read_diff', name: 'read_file', arguments: JSON.stringify({ path: 'phase2_workspace_diff.md' }) },
            {
              id: 'phase2_write_memory',
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'MEMORY.md',
                content: [
                  '# Task Group: Memory model routing',
                  'scope: passive memory extraction model routing in the desktop runtime',
                  'applies_to: cwd=/Users/zy/Documents/setsuna-desktop; reuse_rule=use for memory extraction alignment work',
                  '',
                  '## Task 1: Align passive memory extraction with the selected model',
                  '',
                  '### rollout_summary_files',
                  '',
                  '- rollout_summaries/2026-01-01T00-00-00-demo-memory_model_routing.md (cwd=/Users/zy/Documents/setsuna-desktop, rollout_path=memory, updated_at=2026-01-01T00:00:00.000Z, thread_id=thread)',
                  '',
                  '### keywords',
                  '',
                  '- passive-memory-extraction, memory-consolidation, selected model',
                  '',
                  '## User preferences',
                  '',
                  '- when memory extraction model routing is in scope, preserve the selected-model behavior. [Task 1]',
                  '',
                  '## Reusable knowledge',
                  '',
                  '- Stage-1 output uses raw_memory, rollout_summary, and rollout_slug before phase-2 consolidation. [Task 1]',
                  '',
                ].join('\n'),
              }),
            },
            {
              id: 'phase2_write_summary',
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'memory_summary.md',
                content: [
                  'v1',
                  '',
                  '## User Profile',
                  '',
                  'The user works on Setsuna Desktop memory alignment.',
                  '',
                  '## User preferences',
                  '',
                  '- Preserve selected-model behavior for passive memory extraction work.',
                  '',
                  '## General Tips',
                  '',
                  '- Search MEMORY.md for passive-memory-extraction when memory routing is relevant.',
                  '',
                  "## What's in Memory",
                  '',
                  '### /Users/zy/Documents/setsuna-desktop',
                  '',
                  '#### 2026-01-01',
                  '',
                  '- Memory model routing: keywords=passive-memory-extraction, memory-consolidation; stage-1 to phase-2 alignment notes.',
                  '',
                ].join('\n'),
              }),
            },
          ],
        };
        yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text_delta', text: 'Consolidation complete.' };
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class NoOutputStage1MemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '',
          rollout_summary: '',
          rollout_slug: '',
          memories: [],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ActiveMemorySettingsConfigStore extends MemorySettingsConfigStore {
  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const model = {
      id: 'memory-model',
      name: 'Memory model',
      code: 'memory-model',
      enabled: true,
      maxOutputTokens: 2000,
      thinkingEnabled: true,
      thinkingEfforts: ['medium'],
      defaultThinkingEffort: 'medium',
    };
    return {
      id: 'memory-provider',
      name: 'Memory provider',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      apiKey: '',
      models: [model],
      activeModel: model,
    };
  }
}