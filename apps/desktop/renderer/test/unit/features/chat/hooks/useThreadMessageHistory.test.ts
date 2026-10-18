// @vitest-environment happy-dom

import type { RuntimeFileChangeGroups, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mergeMessages,
  reconcileThreadSnapshot,
  useThreadMessageHistory,
} from '../../../../../src/features/chat/hooks/useThreadMessageHistory.js';

afterEach(cleanup);

describe('thread message history', () => {
  it('invalidates cached older records and an in-flight page when deletion leaves the tail unchanged', async () => {
    const initial = thread([message('tail', 'current answer')], { nextBefore: 4, total: 5 });
    let finish!: (page: { messages: RuntimeMessage[]; nextBefore: null; total: number }) => void;
    const client = { listThreadMessages: vi.fn().mockResolvedValueOnce({
      messages: [message('old', 'removed answer')], nextBefore: 2, total: 5,
      fileChangeGroups: { old_turn: [{ messageId: 'old', run: { id: 'edit', name: 'edit', status: 'success' } }] },
    }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })) };
    const view = renderHook(({ snapshot }) => useThreadMessageHistory(client, snapshot), { initialProps: { snapshot: initial } });
    await act(async () => { await view.result.current.loadOlder(); });
    expect(view.result.current.messages.map((row) => row.id)).toEqual(['old', 'tail']);
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.loadOlder(); });
    const deleted = applyRuntimeEventToThread(initial, { id: 'delete', threadId: initial.id, seq: 11, createdAt: '',
      type: 'messages.deleted', payload: { messageIds: ['old'] },
    });
    view.rerender({ snapshot: deleted });
    expect(view.result.current.messages.map((row) => row.id)).toEqual(['tail']);
    expect(view.result.current.fileChangeGroups).toBeUndefined();
    await act(async () => { finish({ messages: [message('old', 'stale response')], nextBefore: null, total: 5 }); await pending; });
    expect(view.result.current.messages.map((row) => row.id)).toEqual(['tail']);
    view.rerender({ snapshot: { ...deleted, messagePage: { total: 4, nextBefore: 3 } } });
    expect(view.result.current.total).toBe(4);
    expect(view.result.current.hasMore).toBe(true);
  });
  it('carries complete operation groups from older pages and replaces covered groups on resync', async () => {
    const group = (turnId: string, id: string): RuntimeFileChangeGroups => ({ [turnId]: [{ messageId: id,
      run: { id, name: 'edit', status: 'success' },
    }] });
    const older = group('old_turn', 'hidden_old_edit');
    const latest = group('latest_turn', 'hidden_latest_edit');
    const initial = { ...thread([message('tail', 'latest')], { nextBefore: 300, total: 301 }), fileChangeGroups: latest };
    const client = { listThreadMessages: vi.fn(async () => ({
      messages: [message('older', 'older work')], nextBefore: 100, total: 301, fileChangeGroups: older,
    })) };
    const view = renderHook(({ snapshot }) => useThreadMessageHistory(client, snapshot), { initialProps: { snapshot: initial } });
    await act(async () => { await view.result.current.loadOlder(); });
    expect(view.result.current.fileChangeGroups).toEqual({ ...older, ...latest });
    view.rerender({ snapshot: { ...initial, fileChangeGroups: { latest_turn: [] } } });
    expect(view.result.current.fileChangeGroups).toEqual({ ...older, latest_turn: [] });
    view.rerender({ snapshot: { ...initial, id: 'different_thread', fileChangeGroups: {} } });
    expect(view.result.current.fileChangeGroups).toEqual({});
  });

  it('retains rows displaced when the server tail window advances', () => {
    const current = {
      error: null,
      loading: false,
      messages: [message('msg_3', 'old 3'), message('msg_4', 'old 4')],
      nextBefore: 2,
      threadId: 'thread_1',
      total: 4,
      windowRevision: 0,
    };
    const next = thread([
      message('msg_4', 'updated 4'),
      message('msg_5', 'new 5'),
    ], { nextBefore: 3, total: 5 });

    const reconciled = reconcileThreadSnapshot(current, next);

    expect(reconciled.nextBefore).toBe(2);
    expect(reconciled.messages.map((item) => [item.id, item.content])).toEqual([
      ['msg_3', 'old 3'],
      ['msg_4', 'updated 4'],
      ['msg_5', 'new 5'],
    ]);
    expect(reconciled.windowRevision).toBe(0);
  });

  it('keeps loaded history exhausted when SSE carries the cached prefix with an older page cursor', () => {
    const messages = [message('msg_1', 'prompt'), message('msg_2', 'work')];
    const client = { listThreadMessages: vi.fn() };
    const view = renderHook(({ snapshot }) => useThreadMessageHistory(client, snapshot), {
      initialProps: { snapshot: thread(messages, { nextBefore: null, total: 2 }) },
    });
    const tail = [...messages.slice(1), message('msg_3', 'compacted work')];
    view.rerender({ snapshot: thread(tail, { nextBefore: 1, total: 3 }) });
    expect(view.result.current.hasMore).toBe(false);
    // Live projection can contain the prefix even though its snapshot page metadata
    // still describes the old tail. Repeated events must not revive that cursor.
    for (const content of ['next tool', 'next tool completed']) {
      view.rerender({ snapshot: thread([
        ...messages, message('msg_3', 'compacted work'),
        message('msg_4', content),
      ], { nextBefore: 1, total: 4 }) });
      expect(view.result.current.hasMore).toBe(false);
      expect(view.result.current.messages[0]?.id).toBe('msg_1');
    }
  });

  it('finishes loading older history while new assistant messages continue arriving', async () => {
    const older = [message('msg_1', 'older prompt'), message('msg_2', 'older reply')];
    const tail = [message('msg_3', 'current prompt'), message('msg_4', 'current work')];
    let resolvePage!: (page: { messages: RuntimeMessage[]; nextBefore: null; total: number }) => void;
    const client = { listThreadMessages: vi.fn(() => new Promise<{
      messages: RuntimeMessage[]; nextBefore: null; total: number;
    }>((resolve) => { resolvePage = resolve; })) };
    const view = renderHook(({ snapshot }) => useThreadMessageHistory(client, snapshot), {
      initialProps: { snapshot: thread(tail, { nextBefore: 2, total: 4 }) },
    });
    let loading!: Promise<void>;
    act(() => { loading = view.result.current.loadOlder(); });
    view.rerender({ snapshot: thread([...tail, message('msg_5', 'next tool')], { nextBefore: 2, total: 5 }) });
    expect(view.result.current.loading).toBe(true);
    await act(async () => {
      resolvePage({ messages: older, nextBefore: null, total: 4 });
      await loading;
    });
    expect(view.result.current.messages.map((row) => row.id)).toEqual(['msg_1', 'msg_2', 'msg_3', 'msg_4', 'msg_5']);
    expect(view.result.current.hasMore).toBe(false);
    expect(view.result.current.total).toBe(5);
    expect(client.listThreadMessages).toHaveBeenCalledExactlyOnceWith('thread_1', { before: 2, limit: 160 });
  });

  it('drops the cached suffix replaced by an edited-message regeneration', () => {
    const current = {
      error: null,
      loading: false,
      messages: [
        message('msg_1', 'older 1'),
        message('msg_2', 'older 2'),
        message('msg_3', 'original prompt'),
        message('msg_4', 'stale reply'),
        message('msg_5', 'stale follow-up'),
      ],
      nextBefore: null,
      threadId: 'thread_1',
      total: 5,
      windowRevision: 3,
    };
    const next = thread([
      message('msg_3', 'edited prompt'),
      message('msg_6', 'new reply'),
    ], { nextBefore: 2, total: 4 });

    const reconciled = reconcileThreadSnapshot(current, next);

    expect(reconciled.messages.map((item) => `${item.id}:${item.content}`)).toEqual([
      'msg_1:older 1',
      'msg_2:older 2',
      'msg_3:edited prompt',
      'msg_6:new reply',
    ]);
    expect(reconciled.nextBefore).toBeNull();
    expect(reconciled.total).toBe(4);
    expect(reconciled.windowRevision).toBe(4);
  });

  it('treats a page with no cursor as the complete authoritative transcript', () => {
    const current = {
      error: null,
      loading: true,
      messages: [message('msg_1', 'stale'), message('msg_2', 'stale reply')],
      nextBefore: null,
      threadId: 'thread_1',
      total: 2,
      windowRevision: 1,
    };
    const next = thread([message('msg_3', 'replacement')], {
      nextBefore: null,
      total: 1,
    });

    const reconciled = reconcileThreadSnapshot(current, next);

    expect(reconciled.messages.map((item) => item.id)).toEqual(['msg_3']);
    expect(reconciled.loading).toBe(false);
    expect(reconciled.nextBefore).toBeNull();
    expect(reconciled.windowRevision).toBe(2);
  });

  it('uses newer message versions without moving their transcript position', () => {
    expect(mergeMessages(
      [message('msg_1', 'one'), message('msg_2', 'old')],
      [message('msg_2', 'new'), message('msg_3', 'three')],
    ).map((item) => `${item.id}:${item.content}`)).toEqual([
      'msg_1:one',
      'msg_2:new',
      'msg_3:three',
    ]);
  });
});

function message(id: string, content: string): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt: `2026-08-03T00:00:0${id.at(-1)}.000Z`,
    status: 'complete',
  };
}

function thread(
  messages: RuntimeMessage[],
  messagePage: NonNullable<RuntimeThread['messagePage']>,
): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    archived: false,
    messageCount: messagePage.total,
    lastMessagePreview: '',
    messages,
    messagePage,
    lastSeq: 5,
  };
}
