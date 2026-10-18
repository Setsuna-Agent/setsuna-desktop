// @vitest-environment happy-dom
import type { RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RendererFeatureEventHub } from '../../../../src/composition/renderer-feature-event-hub.js';
import { RendererFeatureEventsProvider } from '../../../../src/composition/renderer-feature-events-context.js';
import { useObservedRuntimeThread } from '../../../../src/features/chat/hooks/useObservedRuntimeThread.js';
import { useRuntimeThreadState, type RuntimeThreadClient } from '../../../../src/services/runtime-client/useRuntimeThreadState.js';

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

it.each(['main', 'observed'] as const)('repairs a missed approval after subsequent parallel tool events in %s', async (kind) => {
  vi.useFakeTimers();
  const setup = await mountThread(kind);
  setup.getThread.mockResolvedValue(snapshot(12, true));
  await act(async () => { setup.deliver([parallelTool(12)]); });
  expect(setup.getThread).toHaveBeenCalledExactlyOnceWith('thread');
  expect(setup.current()?.lastSeq).toBe(12);
  expect(setup.current()?.messages[0].toolRuns?.[0]).toMatchObject({ approvalId: 'approval', status: 'pending_approval' });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(setup.changed).toHaveBeenCalledWith('thread', 12, 'turn');
  expect(setup.getThread).toHaveBeenCalledTimes(1);
});

it.each(['main', 'observed'] as const)('coalesces gaps, rejects an outdated recovery and retries a failure in %s', async (kind) => {
  vi.useFakeTimers();
  const setup = await mountThread(kind);
  let finish!: (value: RuntimeThread) => void;
  setup.getThread.mockImplementationOnce(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue(snapshot(14, true));
  await act(async () => { setup.deliver([parallelTool(12)]); });
  await act(async () => { setup.deliver([parallelTool(14)]); });
  expect(setup.getThread).toHaveBeenCalledTimes(1);
  await act(async () => { finish(snapshot(12, true)); });
  expect(setup.current()?.lastSeq).toBe(14);
  expect(setup.current()?.messages[0].toolRuns?.[0].approvalId).toBeUndefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(setup.getThread).toHaveBeenCalledTimes(3);
  expect(setup.current()?.messages[0].toolRuns?.[0].approvalId).toBe('approval');
  setup.unmount();
  await vi.advanceTimersByTimeAsync(5000);
  expect(setup.getThread).toHaveBeenCalledTimes(3);
});

it.each(['main', 'observed'] as const)('recovers a gap even when the later event ends the active turn in %s', async (kind) => {
  vi.useFakeTimers();
  const setup = await mountThread(kind);
  const completed = { ...snapshot(12, false), activeTurnId: null, title: 'Recovered missed metadata' };
  completed.messages[0].toolRuns = [];
  setup.getThread.mockResolvedValue(completed);
  await act(async () => { setup.deliver([{
    id: 'completed', type: 'turn.completed', threadId: 'thread', turnId: 'turn', seq: 12, createdAt: '', payload: {},
  }]); });
  expect(setup.getThread).toHaveBeenCalledExactlyOnceWith('thread');
  expect(setup.current()?.title).toBe('Recovered missed metadata');
});

it.each(['main', 'observed'] as const)('discards an in-flight recovery after switching threads in %s', async (kind) => {
  vi.useFakeTimers();
  const setup = await mountThread(kind);
  let finish!: (value: RuntimeThread) => void;
  setup.getThread.mockImplementationOnce(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }));
  await act(async () => { setup.deliver([parallelTool(12)]); });
  await setup.switchThread();
  await act(async () => { finish(snapshot(12, true)); });
  expect(setup.current()?.id).toBe('other');
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(setup.current()?.id).toBe('other');
});

it.each(['main', 'observed'] as const)('recovers a contiguous truncation before the page even when conditional polling returns null in %s', async (kind) => {
  vi.useFakeTimers();
  const full: RuntimeThread = { ...snapshot(10, false), activeTurnId: null, messages: Array.from({ length: 430 }, (_, index) => ({
    id: `message_${index}`, role: index === 0 ? 'user' : 'assistant', content: `old_${index}`, createdAt: '', status: 'complete',
  })) };
  const initial: RuntimeThread = { ...full, messages: full.messages.slice(-160), messagePage: { total: 430, nextBefore: 270 } };
  const setup = await mountThread(kind, initial);
  let finish!: (thread: RuntimeThread) => void;
  setup.getThread.mockImplementationOnce(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }));
  await act(async () => { setup.deliver([
    { id: 'edit', seq: 11, threadId: 'thread', createdAt: '', type: 'message.updated', payload: { messageId: 'message_0', content: 'edited' } },
    { id: 'truncate', seq: 12, threadId: 'thread', createdAt: '', type: 'messages.truncated',
      payload: { messageId: 'message_0', removedMessageIds: full.messages.slice(1).map((message) => message.id) } },
  ]); });
  expect(setup.current()?.messages).toEqual([]);
  expect(setup.getThread).toHaveBeenCalledExactlyOnceWith('thread');
  const replacement = { id: 'replacement', role: 'assistant' as const, content: 'new answer', createdAt: '', status: 'complete' as const };
  await act(async () => { setup.deliver([{ id: 'created', seq: 13, threadId: 'thread', createdAt: '', type: 'message.created', payload: { message: replacement } }]); });
  await act(async () => finish({ ...full, lastSeq: 13, contextBudgetInvalidatedAtSeq: 12,
    messages: [{ ...full.messages[0], content: 'edited' }, replacement], messagePage: { total: 2, nextBefore: null },
  }));
  expect(setup.current()?.messages.map((message) => message.content)).toEqual(['edited', 'new answer']);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(setup.getThread).toHaveBeenCalledTimes(1);
});

it.each(['main', 'observed'] as const)('recovers legacy truncations whose anchor and removal list are unavailable in %s', async (kind) => {
  vi.useFakeTimers();
  const setup = await mountThread(kind);
  const recovered = { ...snapshot(11, false), messages: [] };
  setup.getThread.mockResolvedValue(recovered);
  const event: StoredThreadEvent = { id: 'legacy', seq: 11, threadId: 'thread', createdAt: '', type: 'messages.truncated',
    payload: { messageId: 'outside_page', removedMessageIds: [] },
  };
  delete (event.payload as Partial<typeof event.payload>).removedMessageIds;
  await act(async () => { setup.deliver([event]); });
  expect(setup.getThread).toHaveBeenCalledExactlyOnceWith('thread');
  expect(setup.current()?.messages).toEqual([]);
});

async function mountThread(kind: 'main' | 'observed', initial = snapshot(10, false)) {
  const getThread = vi.fn(async () => initial);
  const changed = vi.fn<NonNullable<RuntimeThreadClient['getThreadIfChanged']>>().mockResolvedValue(null);
  let listener: Parameters<RuntimeThreadClient['subscribeEvents']>[2] = () => undefined;
  const client: RuntimeThreadClient = {
    getThread, getThreadIfChanged: changed, answerApproval: vi.fn(), clearThreadContext: vi.fn(), compactThreadContext: vi.fn(),
    createThread: vi.fn(), deleteThread: vi.fn(), updateThread: vi.fn(), listThreads: vi.fn(async () => ({ threads: [] })),
    subscribeEvents: vi.fn((_id, _seq, callback) => { listener = callback; return () => undefined; }),
  };
  const hub = new RendererFeatureEventHub();
  const wrapper = ({ children }: { children: ReactNode }) => <RendererFeatureEventsProvider events={hub}>{children}</RendererFeatureEventsProvider>;
  const options = { client, activeProjectId: null, onError: vi.fn(), onTurnSettled: vi.fn(), review: { start: vi.fn() }, setActiveProjectId: vi.fn() };
  const other = { ...initial, id: 'other', activeTurnId: null };
  if (kind === 'main') {
    const view = renderHook(() => useRuntimeThreadState(options), { wrapper });
    await act(async () => { view.result.current.setCurrentThread(initial); });
    getThread.mockClear();
    return {
      getThread, changed, current: () => view.result.current.currentThread, unmount: view.unmount,
      deliver: (events: StoredThreadEvent[]) => listener({ events }),
      switchThread: async () => { await act(async () => { view.result.current.setCurrentThread(other); }); },
    };
  }
  const view = renderHook(({ threadId }) => useObservedRuntimeThread({ client, threadId }), { initialProps: { threadId: 'thread' }, wrapper });
  await act(async () => undefined);
  getThread.mockClear();
  return {
    getThread, changed, current: () => view.result.current.currentThread, unmount: view.unmount,
    deliver: (events: StoredThreadEvent[]) => listener({ events }),
    switchThread: async () => {
      getThread.mockResolvedValue(other);
      await act(async () => { view.rerender({ threadId: 'other' }); });
    },
  };
}

function snapshot(lastSeq: number, pending: boolean): RuntimeThread {
  return {
    id: 'thread', title: 'Thread', createdAt: '', updatedAt: '', archived: false, lastSeq, activeTurnId: 'turn',
    messageCount: 1, lastMessagePreview: '', messages: [{
      id: 'assistant', role: 'assistant', turnId: 'turn', status: 'complete', content: '', createdAt: '',
      toolRuns: [{ id: 'blocked', name: 'delete_file', status: pending ? 'pending_approval' : 'running',
        ...(pending ? { approvalId: 'approval', approvalStatus: 'pending' as const } : {}),
      }],
    }],
  };
}
function parallelTool(seq: number): StoredThreadEvent {
  return { id: `parallel_${seq}`, seq, threadId: 'thread', turnId: 'turn', createdAt: '', type: 'tool.started',
    payload: { toolCallId: `parallel_${seq}`, toolName: 'read_file', argumentsPreview: '{}' },
  };
}
