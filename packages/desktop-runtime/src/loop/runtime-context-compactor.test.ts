import { describe, expect, it } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ModelClient } from '../ports/model-client.js';
import type { RuntimeContextCompactionCandidate } from './context-compaction.js';
import { RuntimeContextCompactor } from './runtime-context-compactor.js';

describe('RuntimeContextCompactor', () => {
  it('reads item-based agent output from current provider adapters', async () => {
    const modelClient = new CompactionModelClient([
      { type: 'item_started', item: { id: 'summary_1', kind: 'agent_message', status: 'in_progress' } },
      { type: 'item_delta', itemId: 'summary_1', delta: '{"summary":"保留当前目标"}' },
      { type: 'item_completed', item: { id: 'summary_1', kind: 'agent_message', content: '{"summary":"保留当前目标"}', status: 'completed' } },
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await createCompactor(modelClient).generateContextCompactionSummary(compactionCandidate());

    expect(result.text).toBe('摘要：\n保留当前目标');
    expect(modelClient.request).toMatchObject({ model: 'context-compaction', thinking: false, toolChoice: 'none' });
  });

  it('uses a bounded source fallback when a provider returns no visible agent text', async () => {
    const modelClient = new CompactionModelClient([{ type: 'done', finishReason: 'stop' }]);

    const result = await createCompactor(modelClient).generateContextCompactionSummary(compactionCandidate());

    expect(result.text).toContain('不可信摘录');
    expect(result.text).toContain('需要保留的用户目标');
  });
});

function createCompactor(modelClient: ModelClient): RuntimeContextCompactor {
  return new RuntimeContextCompactor({
    clock: { now: () => new Date('2026-07-11T00:00:00.000Z') },
    ids: { id: (prefix) => `${prefix}_1` },
    modelClient,
    appendEvent: async () => undefined,
    onCompacted: () => undefined,
    runCompactHooks: async () => ({}),
  });
}

function compactionCandidate(): RuntimeContextCompactionCandidate {
  const olderMessage: RuntimeMessage = {
    id: 'message_1',
    role: 'user',
    content: '需要保留的用户目标',
    createdAt: '2026-07-11T00:00:00.000Z',
    status: 'complete',
  };
  return {
    autoCompactTokenLimit: 800,
    historyTokens: 20,
    maxContextTokens: 1000,
    maxContextTokensK: 1,
    olderMessages: [olderMessage],
    originalTokens: 30,
    pinnedMessages: [],
    recentMessages: [],
    reservedTokens: 0,
    targetContextTokens: 8,
    triggerScopes: ['manual'],
  };
}

class CompactionModelClient implements ModelClient {
  request: ModelRequest | null = null;

  constructor(private readonly events: ModelStreamEvent[]) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.request = request;
    yield* this.events;
  }
}
