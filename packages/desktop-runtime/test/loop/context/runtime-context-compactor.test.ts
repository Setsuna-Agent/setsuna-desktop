import {
  type ModelRequest,
  type ModelStreamEvent,
  type RuntimeConfigState,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeMessageProviderMetadata,
  type RuntimeThread,
  type RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { estimateRuntimeMessageTokens, type RuntimeContextCompactionCandidate } from '../../../src/loop/context/context-compaction.js';
import { RuntimeContextCompactor } from '../../../src/loop/context/runtime-context-compactor.js';
import type { ModelClient, ModelCompactionRequest } from '../../../src/ports/model-client.js';
import type { RuntimeDebugTraceSink } from '../../../src/ports/runtime-debug-trace.js';
import type { UsageRecorder } from '../../../src/ports/usage-store.js';
import { InMemoryConversationDebugTraceStore } from '@setsuna-desktop/feature-conversation-debug/runtime';
import { CapturingUsageStore } from '../../support/agent-loop/shared.js';

describe('RuntimeContextCompactor', () => {
  it.each(['automatic', 'manual'] as const)('reserves a usable summary budget near the 16k limit during %s compaction', async (mode) => {
    const messages: RuntimeMessage[] = [
      { id: 'older', role: 'assistant', content: 'x'.repeat(2_003 * 4 - 'assistant\n'.length), createdAt: '2026-07-11T00:00:00.000Z' },
      { id: 'latest', role: 'user', content: 'y'.repeat(11_518 * 4 - 'user\n'.length), turnId: 'turn_1', createdAt: '2026-07-11T00:00:01.000Z' },
    ];
    const thread = compactionThread(messages);
    const requests: ModelRequest[] = [];
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const client: ModelClient = { stream: async function* (request) {
      requests.push(request);
      yield { type: 'text_delta', text: '{"summary":"Completed the earlier work; continue with the latest user request."}' };
      yield { type: 'done', finishReason: requests.length === 1 ? 'length' : 'stop' };
    } };

    expect(estimateRuntimeMessageTokens(messages) + 2_000).toBe(15_521);
    const compacted = await createCompactor(client, events).compactMessagesBeforeModelRequest({
      force: mode === 'manual', messages, thread, threadId: thread.id, turnId: 'turn_1',
      contextBudget: { maxContextTokens: 16_000 }, reservedTokens: 2_000,
      runtimeConfig: null, signal: new AbortController().signal,
    });

    expect(requests.map((request) => request.maxOutputTokens)).toEqual([4_096, 8_192]);
    expect(compacted.find((message) => message.id === 'latest')).toMatchObject({ content: messages[1]!.content, visibility: 'transcript' });
    expect(compacted.some((message) => message.contextCompaction)).toBe(true);
    expect(estimateRuntimeMessageTokens(compacted) + 2_000).toBeLessThan(13_600);
    expect(events.filter((event) => event.type === 'thread.context_compacted')).toHaveLength(1);
  });

  it.each(['fixed context', 'provider limit'] as const)('does not sample or retry when %s prevents a usable summary', async (reason) => {
    const candidate = compactionCandidate();
    const runtimeConfig = contextCompactionTaskModelConfig();
    if (reason === 'fixed context') {
      candidate.pinnedMessages = [{ ...candidate.olderMessages[0]!, role: 'developer', content: 'policy '.repeat(400) }];
    } else {
      runtimeConfig.providers[1]!.models[0]!.maxOutputTokens = 1;
    }
    const requests: ModelRequest[] = [];
    const client: ModelClient = { stream: async function* (request) {
      requests.push(request);
      yield { type: 'done', finishReason: 'length' };
    } };

    await expect(createCompactor(client).generateContextCompactionSummary({ ...summaryInput(candidate), runtimeConfig }))
      .rejects.toThrow('insufficient output budget');
    expect(requests).toHaveLength(0);
  });

  it('reads item-based agent output from current provider adapters', async () => {
    const modelClient = new CompactionModelClient([
      { type: 'item_started', item: { id: 'summary_1', kind: 'agent_message', status: 'in_progress' } },
      { type: 'item_delta', itemId: 'summary_1', delta: '{"summary":"保留当前目标"}' },
      { type: 'item_completed', item: { id: 'summary_1', kind: 'agent_message', content: '{"summary":"保留当前目标"}', status: 'completed' } },
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await createCompactor(modelClient).generateContextCompactionSummary(summaryInput());

    expect(result.text).toBe('摘要：\n保留当前目标');
    expect(modelClient.request).toMatchObject({ model: 'context-compaction', thinking: false, toolChoice: 'none' });
  });

  it('rejects an empty summary instead of replacing history with a raw excerpt', async () => {
    const modelClient = new CompactionModelClient([{ type: 'done', finishReason: 'stop' }]);

    await expect(createCompactor(modelClient).generateContextCompactionSummary(summaryInput()))
      .rejects.toThrow('original history was retained');
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

    const result = await createCompactor(modelClient).generateContextCompactionSummary(summaryInput(candidate));

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

  it('routes the portable summary through its task model without rebinding native metadata', async () => {
    const modelClient = new NativeCompactionModelClient(nativeCompactionMetadata('encrypted-compaction'));

    await createCompactor(modelClient).generateContextCompactionSummary({
      ...summaryInput(), runtimeConfig: contextCompactionTaskModelConfig(),
    });

    expect(modelClient.summaryRequest).toMatchObject({
      model: 'background-summary-model',
      providerId: 'background-provider',
    });
    expect(modelClient.compactRequest).toMatchObject({ model: 'context-compaction' });
    expect(modelClient.compactRequest).not.toHaveProperty('providerId');
  });

  it('keeps both compaction paths on the bound conversation model when no task model overrides it', async () => {
    const modelClient = new NativeCompactionModelClient(nativeCompactionMetadata('encrypted-compaction'));
    const conversationModel = { providerId: 'chat-provider', model: 'chat-model' };

    await createCompactor(modelClient).generateContextCompactionSummary({ ...summaryInput(), conversationModel });

    expect(modelClient.summaryRequest).toMatchObject(conversationModel);
    expect(modelClient.compactRequest).toMatchObject(conversationModel);
  });

  it('publishes portable and native compaction usage as separate model calls', async () => {
    const portableUsage: RuntimeUsage = {
      providerId: 'background-provider',
      provider: 'Background provider',
      model: 'background-summary-model',
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
    };
    const nativeUsage: RuntimeUsage = {
      providerId: 'chat-provider',
      provider: 'Chat provider',
      model: 'chat-model',
      inputTokens: 11,
      outputTokens: 2,
      totalTokens: 13,
    };
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const usageStore = new CapturingUsageStore();
    const modelClient = new NativeCompactionModelClient(
      nativeCompactionMetadata('encrypted-compaction'),
      portableUsage,
      nativeUsage,
    );
    const compactor = createCompactor(modelClient, events, undefined, usageStore);

    await compactor.generateContextCompactionSummary({
      ...summaryInput(), runtimeConfig: contextCompactionTaskModelConfig(),
    });

    expect(events.filter((event) => event.type === 'token.count')).toMatchObject([
      { payload: { usage: portableUsage } },
      { payload: { usage: nativeUsage } },
    ]);
    expect(usageStore.records).toMatchObject([
      { threadId: 'thread_1', turnId: 'turn_1', ...portableUsage },
      { threadId: 'thread_1', turnId: 'turn_1', ...nativeUsage },
    ]);
  });

  it('downgrades oversized native compaction metadata and publishes a verification warning', async () => {
    const providerMetadata = nativeCompactionMetadata('x'.repeat(2 * 1024 * 1024));
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const modelClient = new NativeCompactionModelClient(providerMetadata);
    const compactor = createCompactor(modelClient, events);

    const result = await compactor.generateContextCompactionSummary(summaryInput());
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

  it('keeps history intact when the summary provider fails', async () => {
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

    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const messages = compactionMessages();
    const thread = compactionThread(messages);
    await expect(createCompactor(modelClient, events).compactMessagesBeforeModelRequest({
      force: true, messages, thread, threadId: thread.id, turnId: 'turn_1', runtimeConfig: null,
      signal: new AbortController().signal,
    })).rejects.toThrow('original history was retained');
    expect(events.map((event) => event.type)).toEqual(['thread.context_compacting']);
    expect(thread.messages).toEqual(messages);
  });

  it('retries a length-limited response once, preserving usage and array-valued progress', async () => {
    const requests: ModelRequest[] = [];
    const usage: RuntimeUsage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };
    const client: ModelClient = { stream: async function* (request) {
      requests.push(request);
      yield { type: 'text_delta', text: JSON.stringify({ summary: 'Reviewed architecture.', already_said: ['Boundary verified.'], tool_context: ['scope.ts checked.'], open_items: ['Write the evaluation.'] }) };
      yield { type: 'usage', usage };
      yield { type: 'done', finishReason: requests.length === 1 ? 'length' : 'stop' };
    } };
    const candidate = { ...compactionCandidate(), autoCompactTokenLimit: 20_000 };
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const usageStore = new CapturingUsageStore();
    const result = await createCompactor(client, events, undefined, usageStore).generateContextCompactionSummary(summaryInput(candidate));
    expect(requests.map((request) => request.maxOutputTokens)).toEqual([4096, 8192]);
    expect(events.filter((event) => event.type === 'token.count')).toMatchObject([
      { payload: { usage } }, { payload: { usage } },
    ]);
    expect(usageStore.records).toMatchObject([usage, usage]);
    expect(result.text).toContain('Boundary verified.');
    expect(result.text).toContain('scope.ts checked.');
    expect(result.text).toContain('Write the evaluation.');
  });

  it.each([
    [{ type: 'text_delta', text: '{"summary":"unfinished' }, { type: 'done', finishReason: 'stop' }],
    [{ type: 'text_delta', text: '{"summary":"valid but the stream never completed"}' }],
  ] as ModelStreamEvent[][])('rejects incomplete compaction streams after one retry (%j)', async (...events) => {
    let attempts = 0;
    const client: ModelClient = { stream: async function* () { attempts += 1; yield* events; } };
    await expect(createCompactor(client).generateContextCompactionSummary(summaryInput())).rejects.toThrow('original history was retained');
    expect(attempts).toBe(2);
  });

  it('passes the complete prior handoff into the next compaction', async () => {
    const client = new CompactionModelClient([{ type: 'text_delta', text: '{"summary":"continued progress"}' }, { type: 'done', finishReason: 'stop' }]);
    const candidate = compactionCandidate();
    candidate.olderMessages[0] = {
      ...candidate.olderMessages[0]!,
      content: 'a'.repeat(4000) + '\nCritical verified decision in the middle.\n' + 'b'.repeat(4000),
      contextCompaction: { compactedMessageCount: 10 } as RuntimeMessage['contextCompaction'],
    };
    await createCompactor(client).generateContextCompactionSummary(summaryInput(candidate));
    expect(client.request?.messages.map((message) => message.content).join('\n')).toContain(candidate.olderMessages[0].content);
  });

  it('records usage without committing a handoff when cancelled at stream completion', async () => {
    const controller = new AbortController();
    const usage: RuntimeUsage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };
    const usageStore = new CapturingUsageStore();
    let attempts = 0;
    const client: ModelClient = { stream: async function* () {
      attempts += 1;
      yield { type: 'text_delta', text: '{"summary":"Complete summary"}' };
      yield { type: 'usage', usage };
      yield { type: 'done', finishReason: 'stop' };
      controller.abort(new Error('Cancelled at stream completion'));
    } };
    const events: Array<Omit<RuntimeEvent, 'seq'>> = [];
    const messages = compactionMessages();
    const thread = compactionThread(messages);
    await expect(createCompactor(client, events, undefined, usageStore).compactMessagesBeforeModelRequest({
      force: true, messages, thread, threadId: thread.id, turnId: 'turn_1', runtimeConfig: null, signal: controller.signal,
    })).rejects.toThrow('Cancelled at stream completion');
    expect(attempts).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['thread.context_compacting', 'token.count']);
    expect(usageStore.records).toMatchObject([{ ...usage, threadId: thread.id, turnId: 'turn_1' }]);
  });

  it('records portable and native summary decisions on the debug channel', async () => {
    let id = 0;
    const traces = new InMemoryConversationDebugTraceStore({
      now: () => new Date('2026-07-11T00:00:00.000Z'),
      id: (prefix) => `${prefix}_${++id}`,
    });
    const modelClient = new CompactionModelClient([
      { type: 'text_delta', text: '{"summary":"Portable summary."}' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const compactor = createCompactor(modelClient, [], traces);

    await compactor.generateContextCompactionSummary({
      ...summaryInput(),
      debugContext: {
        afterEventSeq: 7,
        spanId: 'span_1',
        threadId: 'thread_1',
        turnId: 'turn_1',
      },
    });

    expect(traces.list('thread_1').traces.map((trace) => ({
      kind: trace.kind,
      outcome: 'outcome' in trace.payload ? trace.payload.outcome : undefined,
      spanId: trace.spanId,
    }))).toEqual([
      { kind: 'context.compaction.portable', outcome: 'started', spanId: 'span_1' },
      { kind: 'context.compaction.portable', outcome: 'success', spanId: 'span_1' },
      { kind: 'context.compaction.native', outcome: 'unsupported', spanId: 'span_1' },
    ]);
  });

  it('marks compaction complete only after the persisted compaction event succeeds', async () => {
    let id = 0;
    const traces = new InMemoryConversationDebugTraceStore({
      now: () => new Date('2026-07-11T00:00:00.000Z'),
      id: (prefix) => `${prefix}_${++id}`,
    });
    const modelClient = new CompactionModelClient([
      { type: 'text_delta', text: '{"summary":"Portable summary."}' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const messages = compactionMessages();
    const thread = compactionThread(messages);

    await createCompactor(modelClient, [], traces).compactMessagesBeforeModelRequest({
      force: true,
      messages,
      runtimeConfig: developerRuntimeConfig(),
      signal: new AbortController().signal,
      thread,
      threadId: thread.id,
      turnId: 'turn_1',
    });

    expect(traces.list(thread.id).traces.at(-1)).toMatchObject({
      afterEventSeq: 2,
      kind: 'context.compaction.completed',
      payload: {
        outcome: 'success',
        source: 'local',
      },
    });
  });

  it('keeps compaction behavior independent from debug sink failures', async () => {
    const modelClient = new CompactionModelClient([
      { type: 'text_delta', text: '{"summary":"Portable summary."}' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const failingTrace: RuntimeDebugTraceSink = {
      enabled: () => true,
      append: () => {
        throw new Error('debug sink unavailable');
      },
    };

    await expect(createCompactor(modelClient, [], failingTrace).generateContextCompactionSummary({
      ...summaryInput(),
      debugContext: {
        afterEventSeq: 7,
        spanId: 'span_1',
        threadId: 'thread_1',
        turnId: 'turn_1',
      },
    })).resolves.toMatchObject({ text: '摘要：\nPortable summary.' });
  });
});

function summaryInput(candidate = compactionCandidate()) {
  return { candidate, threadId: 'thread_1', turnId: 'turn_1' };
}

function createCompactor(
  modelClient: ModelClient,
  events: Array<Omit<RuntimeEvent, 'seq'>> = [],
  debugTrace?: RuntimeDebugTraceSink,
  usageStore?: UsageRecorder,
): RuntimeContextCompactor {
  return new RuntimeContextCompactor({
    clock: { now: () => new Date('2026-07-11T00:00:00.000Z') },
    debugTrace,
    ids: { id: (prefix) => `${prefix}_1` },
    modelClient,
    appendEvent: async (_threadId, event) => {
      events.push(event);
      return { ...event, seq: events.length } as RuntimeEvent;
    },
    onCompacted: () => undefined,
    runCompactHooks: async () => ({}),
    usageStore,
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

function compactionMessages(): RuntimeMessage[] {
  return [
    {
      id: 'message_older',
      role: 'user',
      content: 'An older goal that must be summarized.',
      createdAt: '2026-07-11T00:00:00.000Z',
      status: 'complete',
    },
    {
      id: 'message_recent_assistant',
      role: 'assistant',
      content: 'A recent response.',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'complete',
    },
    {
      id: 'message_recent_user',
      role: 'user',
      content: 'Continue.',
      createdAt: '2026-07-11T00:00:02.000Z',
      status: 'complete',
    },
  ];
}

function compactionThread(messages: RuntimeMessage[]): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Compaction trace',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:02.000Z',
    archived: false,
    lastMessagePreview: 'Continue.',
    lastSeq: 0,
    messageCount: messages.length,
    messages,
  };
}

function developerRuntimeConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/runtime',
    storagePath: '/tmp/memory',
    providers: [],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    features: {},
  };
}

function contextCompactionTaskModelConfig(): RuntimeConfigState {
  return {
    ...developerRuntimeConfig(),
    activeProviderId: 'chat-provider',
    providers: [
      {
        id: 'chat-provider',
        name: 'Chat provider',
        provider: 'openai-responses',
        baseUrl: 'https://chat.example/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{
          id: 'chat-model',
          name: 'Chat model',
          code: 'chat-model',
          enabled: true,
          maxOutputTokens: 8_192,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      },
      {
        id: 'background-provider',
        name: 'Background provider',
        provider: 'openai-compatible',
        baseUrl: 'https://background.example/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{
          id: 'background-model',
          name: 'Background summary model',
          code: 'background-summary-model',
          enabled: true,
          maxOutputTokens: 8_192,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      },
    ],
    taskModels: {
      contextCompaction: {
        providerId: 'background-provider',
        modelId: 'background-model',
      },
    },
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

  constructor(
    private readonly providerMetadata: RuntimeMessageProviderMetadata,
    private readonly portableUsage?: RuntimeUsage,
    private readonly nativeUsage?: RuntimeUsage,
  ) {}

  async compactConversation(request: ModelCompactionRequest) {
    this.compactRequest = request;
    return {
      kind: 'native' as const,
      providerMetadata: this.providerMetadata,
      ...(this.nativeUsage ? { usage: this.nativeUsage } : {}),
    };
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.summaryRequest = request;
    yield { type: 'text_delta', text: '{"summary":"Portable independent summary."}' };
    if (this.portableUsage) yield { type: 'usage', usage: this.portableUsage };
    yield { type: 'done', finishReason: 'stop' };
  }
}
