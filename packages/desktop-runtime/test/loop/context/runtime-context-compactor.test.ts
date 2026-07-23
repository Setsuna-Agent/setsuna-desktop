import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeMessageProviderMetadata,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { RuntimeContextCompactionCandidate } from '../../../src/loop/context/context-compaction.js';
import { RuntimeContextCompactor } from '../../../src/loop/context/runtime-context-compactor.js';
import type { ModelClient, ModelCompactionRequest } from '../../../src/ports/model-client.js';

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

  it('passes through bounded native compaction metadata with the portable summary', async () => {
    const providerMetadata = nativeCompactionMetadata('encrypted-compaction');
    const modelClient = new NativeCompactionModelClient(providerMetadata);
    const candidate = compactionCandidate();
    candidate.olderMessages.push({
      id: 'assistant_native',
      role: 'assistant',
      content: 'Native answer',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'complete',
      providerMetadata: {
        schemaVersion: 2,
        source: providerMetadata.source,
        openAiResponses: {
          kind: 'response',
          items: [{
            type: 'reasoning',
            id: 'reasoning_1',
            summary: [],
            encrypted_content: 'encrypted-reasoning',
          }, {
            type: 'message',
            id: 'message_native',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Native answer' }],
          }],
        },
      },
    });

    const result = await createCompactor(modelClient).generateContextCompactionSummary(candidate);

    expect(result).toMatchObject({
      source: 'remote',
      text: '摘要：\nPortable independent summary.',
      providerMetadata,
    });
    expect(modelClient.compactRequest?.messages).toEqual(candidate.olderMessages);
    expect(modelClient.summaryRequest?.messages).not.toEqual(candidate.olderMessages);
    expect(JSON.stringify(modelClient.summaryRequest)).not.toContain('encrypted-reasoning');
    expect(result.omittedProviderMetadata).toBeUndefined();
  });

  it('downgrades oversized native compaction metadata and publishes a verification warning', async () => {
    const providerMetadata = nativeCompactionMetadata('x'.repeat(2 * 1024 * 1024));
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const modelClient = new NativeCompactionModelClient(providerMetadata);
    const compactor = createCompactor(modelClient, events);

    const result = await compactor.generateContextCompactionSummary(compactionCandidate());
    await compactor.publishProviderMetadataWarning('thread_1', 'turn_1', result.omittedProviderMetadata);

    expect(result.providerMetadata).toBeUndefined();
    expect(result.omittedProviderMetadata).toBe(providerMetadata);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'model.verification',
      payload: {
        verification: {
          model: 'gpt-test',
          provider: 'openai-responses',
          warnings: ['provider_metadata_omitted_too_large'],
        },
      },
    }));
  });

  it('keeps a deterministic portable fallback when summary sampling fails', async () => {
    const providerMetadata = nativeCompactionMetadata('encrypted-compaction');
    const modelClient: ModelClient = {
      compactConversation: async () => ({
        kind: 'native',
        providerMetadata,
      }),
      stream: async function* () {
        yield await Promise.reject<ModelStreamEvent>(new Error('summary provider unavailable'));
      },
    };

    const result = await createCompactor(modelClient).generateContextCompactionSummary(compactionCandidate());

    expect(result.text).toContain('自动摘要不可用');
    expect(result.text).toContain('需要保留的用户目标');
    expect(result.providerMetadata).toBe(providerMetadata);
  });
});

function createCompactor(
  modelClient: ModelClient,
  events: Array<Omit<RuntimeEvent, 'seq'>> = [],
): RuntimeContextCompactor {
  return new RuntimeContextCompactor({
    clock: { now: () => new Date('2026-07-11T00:00:00.000Z') },
    ids: { id: (prefix) => `${prefix}_1` },
    modelClient,
    appendEvent: async (_threadId, event) => {
      events.push(event);
    },
    onCompacted: () => undefined,
    runCompactHooks: async () => ({}),
  });
}

function nativeCompactionMetadata(encryptedContent: string): RuntimeMessageProviderMetadata {
  return {
    schemaVersion: 2,
    source: {
      providerId: 'provider-1',
      providerKind: 'openai-responses',
      model: 'gpt-test',
      endpointFingerprint: 'a'.repeat(64),
    },
    openAiResponses: {
      kind: 'compaction',
      responseId: 'resp_compact_1',
      items: [{
        type: 'compaction',
        id: 'cmp_1',
        encrypted_content: encryptedContent,
        created_by: 'model',
      }],
    },
  };
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

class NativeCompactionModelClient implements ModelClient {
  compactRequest: ModelCompactionRequest | null = null;
  summaryRequest: ModelRequest | null = null;

  constructor(private readonly providerMetadata: RuntimeMessageProviderMetadata) {}

  async compactConversation(request: ModelCompactionRequest) {
    this.compactRequest = request;
    return {
      kind: 'native' as const,
      providerMetadata: this.providerMetadata,
    };
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.summaryRequest = request;
    yield { type: 'text_delta', text: '{"summary":"Portable independent summary."}' };
    yield { type: 'done', finishReason: 'stop' };
  }
}
