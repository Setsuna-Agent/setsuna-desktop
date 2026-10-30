import type { ModelRequest, ModelStreamEvent, RuntimeConfigState, RuntimeMessage } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { ContextWindowConfigStore, mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createGoalEnabledAgentLoop } from '../../support/agent-loop/goal-feature.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('agent loop background compaction', () => {
  it('finishes the foreground answer before generation and installs only at the next sampling boundary', async () => {
    const { loop, store, thread, requests, release, compactionStarted } = await fixture();
    await loop.sendTurn(thread.id, { input: 'Continue the task' });
    await compactionStarted;
    const answered = await store.getThread(thread.id);
    expect(answered?.messages.at(-1)?.content).toBe('Completed answer');
    expect(answered?.activeTurnId).toBeNull();
    expect((await store.listEvents(thread.id)).some((event) => event.type === 'thread.context_compacted')).toBe(false);
    release();
    await vi.waitFor(async () => {
      expect((await store.listEvents(thread.id)).filter((event) => event.type === 'token.count')).toHaveLength(1);
    });
    await loop.sendTurn(thread.id, { input: 'Keep the Windows implementation as well' });
    const events = await store.listEvents(thread.id);
    expect(events.filter((event) => event.type === 'thread.context_compacted')).toHaveLength(1);
    const last = requests.filter((request) => request.usageContext?.source !== 'compaction').at(-1)!;
    expect(last.messages.some((message) => message.content.includes('Keep the Windows implementation as well'))).toBe(true);
    expect(last.messages.some((message) => message.contextCompaction)).toBe(true);
    expect(requests.filter((request) => request.usageContext?.source === 'compaction')).toHaveLength(1);
  });

  it('keeps failed speculative generation out of the completed turn and records its actual usage once', async () => {
    const { loop, store, thread, release, compactionStarted } = await fixture({ fail: true });
    await loop.sendTurn(thread.id, { input: 'Continue the task' });
    await compactionStarted;
    release();
    await vi.waitFor(async () => {
      expect((await store.listEvents(thread.id)).filter((event) => event.type === 'token.count')).toHaveLength(1);
    });
    const events = await store.listEvents(thread.id);
    expect(events.some((event) => event.type === 'runtime.error' || event.type === 'thread.context_compacting' || event.type === 'thread.context_compacted')).toBe(false);
    expect((await store.getThread(thread.id))?.messages.at(-1)?.content).toBe('Completed answer');
  });

  it('precomputes after a completed answer grows past the soft limit without creating startup work', async () => {
    const { loop, store, thread, requests, release, compactionStarted } = await fixture({ answerGrowth: true });
    expect(requests).toHaveLength(0);
    await loop.sendTurn(thread.id, { input: 'Continue the task' });
    await compactionStarted;
    expect(requests[0]?.usageContext?.source).not.toBe('compaction');
    expect((await store.getThread(thread.id))?.activeTurnId).toBeNull();
    release();
  });

  it('drains speculative usage writes before a destructive thread operation', async () => {
    const { loop, store, thread, release, compactionStarted } = await fixture();
    await loop.sendTurn(thread.id, { input: 'Continue the task' });
    await compactionStarted;
    let mutationStarted = false;
    const mutation = loop.withThreadDeletionBarrier(thread.id, async () => { mutationStarted = true; });
    await Promise.resolve();
    expect(mutationStarted).toBe(false);
    release();
    await mutation;
    expect(mutationStarted).toBe(true);
    expect((await store.listEvents(thread.id)).some((event) => event.type === 'thread.context_compacted')).toBe(false);
  });

  it('accounts background usage before Goal settlement advances its usage watermark', async () => {
    const { loop, store, thread, release, requests } = await fixture({ goal: true });
    await loop.setThreadGoal(thread.id, { objective: 'Continue the audit', status: 'active' });
    await vi.waitFor(async () => expect((await store.getThread(thread.id))?.messages.at(-1)?.content).toBe('Completed answer'));
    expect((await loop.getThreadGoal(thread.id))?.tokensUsed).toBe(0);
    release();
    await vi.waitFor(async () => expect((await loop.getThreadGoal(thread.id))?.status).toBe('blocked'));
    const counts = (await store.listEvents(thread.id)).filter((event) => event.type === 'token.count');
    expect(counts.length).toBeGreaterThan(0);
    expect((await loop.getThreadGoal(thread.id))?.tokensUsed).toBe(counts.reduce((sum, event) => sum + (event.payload.usage.totalTokens ?? 0), 0));
    expect(requests.filter((request) => request.usageContext?.source !== 'compaction')).toHaveLength(3);
  });
});

async function fixture(options: { fail?: boolean; answerGrowth?: boolean; goal?: boolean } = {}) {
  const ids = new RandomIdGenerator();
  const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
  cleanup.push(() => store.close());
  const thread = await store.createThread({ title: 'Background compaction' });
  const history: RuntimeMessage[] = [
    { id: 'task', role: 'user', content: 'Preserve constraints and finish the task.', createdAt: thread.createdAt, status: 'complete' },
    { id: 'evidence', role: 'assistant', phase: 'final_answer', content: 'Verified evidence. '.repeat(options.answerGrowth ? 2500 : 5500), createdAt: thread.createdAt, status: 'complete' },
  ];
  for (const message of history) await store.appendEvent(thread.id, {
    id: ids.id('event'), threadId: thread.id, createdAt: thread.createdAt, type: 'message.created', payload: { message },
  });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const compactionStarted = new Promise<void>((resolve) => { started = resolve; });
  const requests: ModelRequest[] = [];
  const loop = (options.goal ? createGoalEnabledAgentLoop : (input: ConstructorParameters<typeof AgentLoop>[0]) => new AgentLoop(input))({
    threadStore: store, configStore: new BackgroundConfig(), clock: systemClock, ids, eventBus: new InMemoryEventBus(),
    modelClient: { stream: async function* (request): AsyncGenerator<ModelStreamEvent> {
      requests.push(request);
      if (request.usageContext?.source === 'compaction') {
        started();
        await gate;
        yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 40, totalTokens: 1240 } };
        if (options.fail) throw new Error('Temporary provider failure');
        yield { type: 'text_delta', text: 'Verified the previous evidence; preserve constraints and continue the remaining task.' };
      } else yield { type: 'text_delta', text: options.answerGrowth ? 'Completed work. '.repeat(6000) : 'Completed answer' };
      yield { type: 'done', finishReason: 'stop' };
    } },
  });
  cleanup.push(async () => { release(); await loop.shutdown(); });
  return { loop, store, thread, requests, release, compactionStarted };
}

class BackgroundConfig extends ContextWindowConfigStore {
  constructor() { super(64_000); }
  override async getConfig(): Promise<RuntimeConfigState> {
    const config = await super.getConfig();
    return { ...config, features: { backgroundContextCompaction: true },
      desktopSettings: { ...config.desktopSettings, modelAutoCompactTokenLimit: 40_000 } };
  }
}
