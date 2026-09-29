// @vitest-environment happy-dom
import type { RuntimeEvent, RuntimeEventBatch, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RendererFeatureEventHub } from '../../../../src/composition/renderer-feature-event-hub.js';
import { RendererFeatureEventsProvider } from '../../../../src/composition/renderer-feature-events-context.js';
import { useRuntimeThreadState, type RuntimeThreadClient } from '../../../../src/services/runtime-client/useRuntimeThreadState.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const source: RuntimeThread = {
  id: 'source', title: 'Source', archived: false, createdAt: '', updatedAt: '', lastSeq: 5,
  messageCount: 1, lastMessagePreview: '', activeTurnId: 'turn', messages: [{
    id: 'message', role: 'assistant', content: 'Before', createdAt: '', status: 'streaming', turnId: 'turn',
  }],
};
const other: RuntimeThread = { ...source, id: 'other', activeTurnId: undefined, messages: [], messageCount: 0 };
const deletion: RuntimeEvent = { id: 'delete', type: 'thread.deleted', threadId: source.id, seq: 8, createdAt: '', payload: {} };

function setup() {
  const subscriptions: { receive: (batch: RuntimeEventBatch) => void; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
  const compactThreadContext = vi.fn<RuntimeThreadClient['compactThreadContext']>();
  const client: RuntimeThreadClient = {
    answerApproval: vi.fn(), clearThreadContext: vi.fn(), compactThreadContext,
    createThread: vi.fn(), deleteThread: vi.fn(), updateThread: vi.fn(),
    getThread: vi.fn(async (id) => id === source.id ? source : other),
    listThreads: vi.fn(async () => ({ threads: [other] })),
    subscribeEvents: vi.fn((_id, _seq, receive) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ receive, unsubscribe });
      return unsubscribe;
    }),
  };
  const onThreadDeleted = vi.fn();
  const onError = vi.fn();
  const options = { activeProjectId: null, client, onError, onThreadDeleted, onTurnSettled: vi.fn(),
    review: { start: vi.fn() }, setActiveProjectId: vi.fn() };
  const events = new RendererFeatureEventHub();
  const view = renderHook(() => useRuntimeThreadState(options), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <RendererFeatureEventsProvider events={events}>{children}</RendererFeatureEventsProvider>
    ),
  });
  return { ...view, client, compactThreadContext, subscriptions, onThreadDeleted, onError };
}

it('clears every subscribed window, including archived selection, and cancels queued projections on deletion', async () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 123);
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
  const first = setup();
  const second = setup();
  for (const windowState of [first, second]) {
    await act(async () => {
      await windowState.result.current.applyBootstrapThreads({
        allThreads: [windowState === second ? { ...source, archived: true } : source, other],
        visibleThreads: windowState === second ? [other] : [source, other], projects: [],
      });
      windowState.result.current.setCurrentThread(source);
    });
  }
  // The second window can have an archived snapshot selected independently.
  act(() => second.result.current.setCurrentThread({ ...source, archived: true }));
  for (const windowState of [first, second]) {
    const subscription = windowState.subscriptions.at(-1)!;
    act(() => {
      subscription.receive({ events: [{ ...deletion, id: 'warning', seq: 6, type: 'runtime.warning', payload: { message: 'Activity' } }] });
    });
    expect(windowState.result.current.activityEvents).toHaveLength(1);
    act(() => {
      subscription.receive({ events: [{ ...deletion, id: 'delta', seq: 7, type: 'message.delta', payload: { messageId: 'message', text: ' queued' } }] });
      subscription.receive({ events: [deletion] });
    });
    expect(windowState.result.current.currentThread).toBeNull();
    expect(windowState.result.current.activeTurnId).toBeNull();
    expect(windowState.result.current.activityEvents).toEqual([]);
    expect(windowState.result.current.threads.map((thread) => thread.id)).toEqual([other.id]);
    expect(windowState.result.current.archivedThreads).toEqual([]);
    expect(windowState.onThreadDeleted).toHaveBeenCalledExactlyOnceWith(source.id);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    act(() => subscription.receive({ events: [deletion] }));
    expect(windowState.onThreadDeleted).toHaveBeenCalledOnce();
  }
  expect(cancelFrame).toHaveBeenCalledWith(123);
  expect(localStorage.getItem('setsuna-desktop:last-active-thread-id')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  for (const windowState of [first, second]) {
    expect(windowState.client.listThreads).toHaveBeenCalled();
    expect(windowState.result.current.currentThread).toBeNull();
    // Only the initial bootstrap read remains; deletion stops active-turn polling.
    expect(windowState.client.getThread).toHaveBeenCalledOnce();
    expect(windowState.onError).not.toHaveBeenCalled();
  }
});

it('ignores deletion for a previously selected thread and preserves the new selection', () => {
  const state = setup();
  act(() => state.result.current.setCurrentThread(source));
  const oldSubscription = state.subscriptions.at(-1)!;
  act(() => state.result.current.setCurrentThread(other));
  act(() => oldSubscription.receive({ events: [deletion] }));
  expect(state.result.current.currentThread?.id).toBe(other.id);
  expect(state.onThreadDeleted).not.toHaveBeenCalled();
  expect(localStorage.getItem('setsuna-desktop:last-active-thread-id')).toBe(other.id);
});

it('discards compaction results that arrive after the selected thread was deleted', async () => {
  const state = setup();
  let finish!: (thread: RuntimeThread) => void;
  state.compactThreadContext.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => state.result.current.setCurrentThread(source));
  let compacting!: Promise<RuntimeThread | null>;
  act(() => { compacting = state.result.current.compactCurrentThreadContext(); });
  expect(state.result.current.contextCompacting).toBe(true);
  act(() => state.subscriptions.at(-1)!.receive({ events: [deletion] }));
  expect(state.result.current.contextCompacting).toBe(false);
  await act(async () => { finish({ ...source, lastSeq: 7 }); await compacting; });
  expect(state.result.current.currentThread).toBeNull();
  expect(state.onThreadDeleted).toHaveBeenCalledExactlyOnceWith(source.id);
});
