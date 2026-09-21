import type { ModelRequest, ModelStreamEvent, RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { estimateRuntimeMessageTokens } from '../../../src/loop/context/context-compaction.js';
import { systemClock } from '../../../src/ports/clock.js';
import { TestConfigStore, mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('compaction with missing model limits', () => {
  it.each([300, 400])('resumes a %i-message conversation without configuring a context window', async (count) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Unknown model capacity' });
    const history: RuntimeMessage[] = Array.from({ length: count }, (_, index) => ({
      id: `history_${index}`, role: index % 2 ? 'assistant' : 'user',
      content: `Verified evidence ${index}: ${'x'.repeat(2900)} end ${index}.`,
      createdAt: thread.createdAt, status: 'complete', turnId: 'history_turn',
    }));
    for (const message of history) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'), threadId: thread.id, type: 'message.created',
        createdAt: message.createdAt, payload: { message },
      });
    }
    const model = {
      id: 'model', code: 'unknown-model', name: 'Unknown model', enabled: true,
      maxOutputTokens: 68_000, thinkingEnabled: false, thinkingEfforts: [],
    };
    const provider = {
      id: 'test', name: 'Custom provider', provider: 'openai-compatible' as const,
      baseUrl: 'https://model.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***', models: [model],
    };
    const configStore = new TestConfigStore(
      { ...await new TestConfigStore().getConfig(), providers: [provider] },
      { ...provider, apiKey: 'secret', activeModel: model },
    );
    const compactions: ModelRequest[] = [];
    const conversations: ModelRequest[] = [];
    let lastSummary = '';
    const loop = new AgentLoop({
      threadStore, ids, clock: systemClock, eventBus: new InMemoryEventBus(), configStore,
      modelClient: { stream: async function* (request): AsyncGenerator<ModelStreamEvent> {
        const events = await threadStore.listEvents(thread.id, 0);
        if (request.messages[0]?.id === 'context_compaction_system') {
          expect(events.some((event) => event.type === 'thread.context_compacted')).toBe(false);
          expect(estimateRuntimeMessageTokens(request.messages) + request.maxOutputTokens!).toBeLessThanOrEqual(256_000);
          if (lastSummary) expect(request.messages[1]!.content).toContain(lastSummary);
          compactions.push(request);
          yield { type: 'usage', usage: { inputTokens: 1_000, outputTokens: 20, totalTokens: 1_020 } };
          if (count === 400 && compactions.length === 2) {
            yield { type: 'done', finishReason: 'length' };
            return;
          }
          lastSummary = `Verified progress through batch ${compactions.length}. Continue the current task.`;
          yield { type: 'text_delta', text: lastSummary };
        } else {
          expect(events.filter((event) => event.type === 'thread.context_compacted')).toHaveLength(1);
          expect(request.stepSnapshot?.contextWindow?.maxContextTokens).toBe(256_000);
          expect(request.stepSnapshot!.contextWindow!.estimatedTokens).toBeLessThan(217_600);
          expect(request.messages.some((message) => message.content.includes(lastSummary))).toBe(true);
          conversations.push(request);
          yield { type: 'text_delta', text: 'Task completed after compaction.' };
        }
        yield { type: 'done', finishReason: 'stop' };
      } },
    });

    await loop.sendTurn(thread.id, { input: 'Continue the task.' });
    expect(compactions.length).toBeGreaterThan(1);
    if (count === 400) {
      expect(compactions[2]!.messages[1]!.content).toContain('上一次未得到可用交接文本');
      const source = (request: ModelRequest) => request.messages[1]!.content.split('<untrusted_older_history>')[1];
      expect(source(compactions[2]!)).toBe(source(compactions[1]!));
    }
    const requestsAfterCompaction = compactions.length;
    await loop.sendTurn(thread.id, { input: 'Finish the follow-up.' });
    expect(compactions).toHaveLength(requestsAfterCompaction);
    expect(conversations).toHaveLength(2);
    const events = await threadStore.listEvents(thread.id, 0);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(events.filter((event) => event.type === 'thread.context_compacted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'token.count')).toHaveLength(compactions.length);
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.turns?.at(-1)?.status).toBe('completed');
    expect(saved?.messages.at(-1)?.content).toBe('Task completed after compaction.');
    expect((await configStore.getConfig()).providers[0]!.models[0]!.contextWindowTokens).toBeUndefined();
  });
});
