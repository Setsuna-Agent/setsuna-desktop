import type { RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  mergeMessages,
  reconcileThreadSnapshot,
} from '../../../../../src/features/chat/hooks/useThreadMessageHistory.js';

describe('thread message history', () => {
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
    expect(reconciled.windowRevision).toBe(1);
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
