import { describe, expect, it } from 'vitest';
import { InMemoryRuntimeDebugTraceStore } from '../../../src/adapters/debug/in-memory-runtime-debug-trace-store.js';

describe('InMemoryRuntimeDebugTraceStore', () => {
  it('keeps a bounded sequence-addressable buffer per thread', () => {
    let id = 0;
    const store = new InMemoryRuntimeDebugTraceStore(
      { now: () => new Date('2026-07-23T00:00:00.000Z') },
      { id: (prefix) => `${prefix}_${++id}` },
    );

    for (let index = 0; index < 10_002; index += 1) {
      store.append({
        afterEventSeq: index,
        kind: 'model.history.normalized',
        threadId: 'thread_1',
        payload: {
          inputMessageCount: index,
          interruptedToolResultMessageIds: [],
          orphanToolResultMessageIds: [],
          outputMessageCount: index,
          warnings: [],
          wireToolCallRewrites: [],
        },
      });
    }

    expect(store.list('thread_1')).toMatchObject({
      droppedBeforeSeq: 2,
      nextSeq: 10_003,
    });
    expect(store.list('thread_1').traces).toHaveLength(10_000);
    expect(store.list('thread_1', 10_000).traces.map((trace) => trace.seq)).toEqual([
      10_001,
      10_002,
    ]);
  });

  it('evicts the least recently used thread buffer', () => {
    let id = 0;
    const store = new InMemoryRuntimeDebugTraceStore(
      { now: () => new Date('2026-07-23T00:00:00.000Z') },
      { id: (prefix) => `${prefix}_${++id}` },
    );

    for (let index = 1; index <= 50; index += 1) appendTrace(store, `thread_${index}`);
    store.list('thread_1');
    appendTrace(store, 'thread_51');

    expect(store.list('thread_1').traces).toHaveLength(1);
    expect(store.list('thread_2')).toEqual({ nextSeq: 1, traces: [] });
    expect(store.list('thread_51').traces).toHaveLength(1);
  });
});

function appendTrace(store: InMemoryRuntimeDebugTraceStore, threadId: string): void {
  store.append({
    afterEventSeq: 0,
    kind: 'provider.replay.decision',
    threadId,
    payload: {
      messageId: 'assistant_1',
      model: 'model_1',
      nativeItemCount: 0,
      providerId: 'provider_1',
      providerKind: 'openai-compatible',
      reason: 'unsupported_provider',
      strategy: 'semantic',
    },
  });
}
