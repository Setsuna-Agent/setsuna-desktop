// @vitest-environment happy-dom

import type {
  RuntimeEventBatch,
  RuntimeThread,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationDebugVisibility,
  type ConversationDebugVisibility,
} from '../../src/renderer/conversationDebugVisibility.js';
import { useConversationDebugEvents } from '../../src/renderer/useConversationDebugEvents.js';

afterEach(cleanup);

describe('useConversationDebugEvents', () => {
  it('commits each history page before subscribing live at the fixed watermark', async () => {
    const firstPage = deferred<ReturnType<typeof eventPage>>();
    const secondPage = deferred<ReturnType<typeof eventPage>>();
    const listEvents = vi.fn()
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => secondPage.promise);
    const subscribeEvents = vi.fn((
      _threadId: string,
      _sinceSeq: number | undefined,
      _onBatch: (batch: RuntimeEventBatch) => void,
    ) => () => undefined);
    const eventSource = { subscribeEvents };
    const service = { listEvents };
    const thread = runtimeThread(3);

    const view = renderHook(() => useConversationDebugEvents(
      eventSource,
      service,
      thread,
      visibility(3),
    ));

    expect(view.result.current).toMatchObject({ events: [], syncing: true });
    expect(listEvents).toHaveBeenCalledWith('thread_1', {
      afterSeq: 0,
      limit: 500,
      throughSeq: 3,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(subscribeEvents).not.toHaveBeenCalled();

    await act(async () => firstPage.resolve(eventPage([event(1), event(2)], 3)));

    expect(view.result.current.events.map((item) => item.seq)).toEqual([1, 2]);
    expect(view.result.current.syncing).toBe(true);
    expect(listEvents).toHaveBeenLastCalledWith('thread_1', {
      afterSeq: 2,
      limit: 500,
      throughSeq: 3,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(subscribeEvents).not.toHaveBeenCalled();

    await act(async () => secondPage.resolve(eventPage([event(3)], 3)));

    expect(view.result.current.events.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(view.result.current.syncing).toBe(false);
    expect(subscribeEvents).toHaveBeenCalledWith('thread_1', 3, expect.any(Function));
  });

  it('backfills a missed turn from a resync-only batch without reviving the replaced turn', async () => {
    const recoveryPage = deferred<ReturnType<typeof eventPage>>();
    const originalEvents = [event(1), event(2), event(3)];
    const recoveredEvents = [4, 5, 6].map((seq) => ({ ...event(seq), turnId: 'turn_2' }));
    const listEvents = vi.fn()
      .mockResolvedValueOnce(eventPage(originalEvents, 3))
      .mockReturnValueOnce(recoveryPage.promise);
    const subscribeEvents = vi.fn((
      _threadId: string,
      _sinceSeq: number | undefined,
      _onBatch: (batch: RuntimeEventBatch) => void,
    ) => () => undefined);
    const eventSource = { subscribeEvents };
    const service = { listEvents };
    const initialThread = { ...runtimeThread(3), activeTurnId: 'turn_1' };
    const recoveredThread = { ...runtimeThread(6), activeTurnId: 'turn_2' };
    const view = renderHook(({ thread }) => useConversationDebugEvents(
      eventSource,
      service,
      thread,
      createConversationDebugVisibility(thread),
    ), { initialProps: { thread: initialThread } });
    await act(async () => {});
    expect(view.result.current.events).toEqual(originalEvents);

    // The chat projection can catch up before the debugger's separate subscription.
    view.rerender({ thread: recoveredThread });
    expect(view.result.current.events).toEqual([]);
    act(() => subscribeEvents.mock.calls[0]![2]({
      events: [],
      resync: {
        reason: 'retention_gap',
        requestedSinceSeq: 3,
        retainedFromSeq: 6,
        thread: recoveredThread,
      },
    }));
    expect(view.result.current.syncing).toBe(true);
    expect(listEvents).toHaveBeenLastCalledWith('thread_1', {
      afterSeq: 3,
      limit: 500,
      throughSeq: 6,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));

    await act(async () => recoveryPage.resolve(eventPage(recoveredEvents, 6)));
    expect(view.result.current.events).toEqual(recoveredEvents);
    expect(view.result.current.syncing).toBe(false);
    expect(view.result.current.error).toBeNull();
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });
});

function event(seq: number): StoredThreadEvent {
  return {
    createdAt: `2026-08-25T00:00:0${seq}.000Z`,
    id: `event_${seq}`,
    payload: { input: `input ${seq}` },
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'turn.started',
  };
}

function eventPage(records: readonly StoredThreadEvent[], throughSeq: number) {
  return Object.freeze({ records: Object.freeze([...records]), throughSeq });
}

function runtimeThread(lastSeq: number): RuntimeThread {
  return {
    archived: false,
    createdAt: '2026-08-25T00:00:00.000Z',
    id: 'thread_1',
    lastMessagePreview: '',
    lastSeq,
    messageCount: 0,
    messages: [],
    title: 'Thread',
    updatedAt: '2026-08-25T00:00:00.000Z',
  };
}

function visibility(lastSeq: number): ConversationDebugVisibility {
  return {
    activeTurnId: null,
    key: `thread_1:${lastSeq}`,
    lastSeq,
    messageIds: new Set(),
    messageTurnIds: new Map(),
    supersededTurnIds: new Set(),
    toolCallIds: new Set(),
    turnGroupIds: new Map([['turn_1', 'turn_1']]),
    turnIds: new Set(['turn_1']),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
