import type { ModelProviderRuntimeConfig } from '@setsuna-desktop/feature-model-provider/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PiModelClient } from '../../../../features/model-provider/src/runtime/pi-model-client.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { mkDataDir, TestConfigStore } from '../../support/agent-loop/shared.js';

describe('agent loop output budget', () => {
  it.each([
    { historyCount: 1, outputLimit: 384_000, compact: false, clamp: false },
    { historyCount: 34, outputLimit: 384_000, compact: false, clamp: true },
    { historyCount: 34, outputLimit: 1_000_000, compact: false, clamp: true },
    { historyCount: 38, outputLimit: 384_000, compact: true, clamp: false },
  ])('fits output after $historyCount history messages with a $outputLimit limit (compact: $compact)', async ({ historyCount, outputLimit, compact, clamp }) => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const store = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await store.createThread({ title: 'Large output budget' });
    const activeModel = {
      id: 'model', name: 'Model', code: 'model-code', enabled: true,
      contextWindowTokens: 1_000_000, maxOutputTokens: outputLimit,
      thinkingEnabled: false, thinkingEfforts: [],
    };
    const provider: ModelProviderRuntimeConfig = {
      id: 'provider', name: 'Provider', provider: 'anthropic',
      baseUrl: 'https://provider.test/v1', apiKey: 'test-key', enabled: true,
      models: [activeModel], activeModel,
    };
    const providerState = { ...provider, apiKeySet: true, apiKeyPreview: '***' };
    const config = {
      ...await new TestConfigStore().getConfig(),
      activeProviderId: provider.id,
      providers: [providerState],
    };
    // Each message is about 20K input: 680K fits with capped output; 760K still needs compaction.
    for (let index = 0; index < historyCount; index += 1) {
      await store.appendEvent(thread.id, {
        id: ids.id('event'), threadId: thread.id, type: 'message.created', createdAt: thread.createdAt,
        payload: { message: {
          id: `history_${index}`, role: index % 2 ? 'assistant' : 'user',
          content: `Evidence ${index}: ${'x'.repeat(80_000)}`,
          createdAt: thread.createdAt, status: 'complete',
        } },
      });
    }
    const bodies: Array<{ max_tokens: number; messages: unknown[]; system?: unknown }> = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as typeof bodies[number];
      bodies.push(body);
      const inputTokens = Math.ceil(JSON.stringify({ messages: body.messages, system: body.system }).length / 4);
      if (inputTokens + body.max_tokens > activeModel.contextWindowTokens) {
        return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Input and max_tokens exceed the context window.' } }, { status: 400 });
      }
      return anthropicReply();
    };
    const modelClient = new PiModelClient({
      appVersion: 'test', dataDir, fetchForRoute: () => fetch,
      readProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      // A later provider settings read must not enlarge the captured request's output limit.
      resolveProvider: async () => ({ ...provider, activeModel: { ...activeModel, maxOutputTokens: outputLimit * 2 } }),
      saveProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      writeClipboardText: async () => undefined,
    });
    const stream = vi.spyOn(modelClient, 'stream');
    const loop = new AgentLoop({
      threadStore: store, modelClient, ids, clock: systemClock,
      eventBus: new InMemoryEventBus(), configStore: new TestConfigStore(config, provider),
    });

    await loop.sendTurn(thread.id, { input: 'Continue from the verified evidence.' });

    const requests = stream.mock.calls.map(([request]) => request);
    const conversation = requests.find((request) => request.usageContext?.source === 'conversation')!;
    const budget = conversation.stepSnapshot!.contextWindow!;
    const inputTokens = budget.messageTokens! + budget.toolDefinitionTokens!;
    expect(budget.maxOutputTokens).toBe(conversation.maxOutputTokens);
    expect(bodies.at(-1)?.max_tokens).toBe(conversation.maxOutputTokens);
    expect(inputTokens + conversation.maxOutputTokens!).toBeLessThanOrEqual(activeModel.contextWindowTokens - 1_024);
    if (clamp) {
      expect(conversation.maxOutputTokens).toBeLessThan(outputLimit);
      expect(conversation.maxOutputTokens).toBeGreaterThan(budget.reservedOutputTokens!);
    } else expect(conversation.maxOutputTokens).toBe(outputLimit);
    expect(budget.reservedOutputTokens).toBe(150_000);
    expect(budget.estimatedTokens).toBeLessThan(budget.autoCompactTokenLimit);
    expect(budget.tokensUntilCompaction).toBeGreaterThan(0);
    expect(conversation.messages.some((message) => message.contextCompaction)).toBe(compact);
    const events = await store.listEvents(thread.id);
    if (compact) {
      expect(requests[0]?.usageContext?.source).toBe('compaction');
      const compaction = events.find((event) => event.type === 'thread.context_compacted')!;
      const sampling = events.find((event) => event.type === 'turn.step_snapshot')!;
      expect(compaction.seq).toBeLessThan(sampling.seq);
    } else {
      expect(requests).toHaveLength(1);
      expect(events.some((event) => event.type === 'thread.context_compacting')).toBe(false);
    }
    expect((await store.getThread(thread.id))?.turns?.at(-1)?.stepSnapshots?.at(-1)?.snapshot.contextWindow?.maxOutputTokens).toBe(conversation.maxOutputTokens);
    expect((await store.getThread(thread.id))?.turns?.at(-1)?.status).toBe('completed');
  });
});

function anthropicReply(): Response {
  const events = [
    { type: 'message_start', message: { id: 'reply', model: 'model-code', role: 'assistant', content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Verified the earlier evidence. Continue the remaining task.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
