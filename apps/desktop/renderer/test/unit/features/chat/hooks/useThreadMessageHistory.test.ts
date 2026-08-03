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
