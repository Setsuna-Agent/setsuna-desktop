import { expect, it } from 'vitest';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';
import { mailboxMessageId, threadMessageTranscriptId } from '../src/threads/mailbox.js';

it('keeps consumption from an older mailbox checkpoint when compaction removes its model copy', () => {
  const createdAt = '2026-06-26T00:00:00.000Z';
  const threadMessage = { from: { id: 'peer', title: 'Planning' } };
  const delivered = { id: 'delivered', createdAt, content: 'Delivered report', threadMessage };
  const pending = { id: 'pending', createdAt, content: 'Pending report', threadMessage };
  const thread: RuntimeThread = {
    id: 'thread_1', title: 'Review', createdAt, updatedAt: createdAt, archived: false,
    messageCount: 2, lastMessagePreview: pending.content, lastSeq: 6,
    mailboxDeliveries: [delivered, pending],
    messages: [
      { ...delivered, id: threadMessageTranscriptId(delivered.id), role: 'user', visibility: 'transcript' },
      { ...delivered, id: mailboxMessageId(delivered.id), role: 'user', visibility: 'model', promptSource: 'collaboration' },
      { ...pending, id: threadMessageTranscriptId(pending.id), role: 'user', visibility: 'transcript' },
    ],
  };
  const compacted = applyRuntimeEventToThread(thread, {
    id: 'compact', seq: 7, threadId: thread.id, type: 'thread.context_compacted', createdAt,
    payload: {
      notice: { compactedMessageCount: 1, compactedTokens: 20, keptRecentMessageCount: 0,
        maxContextTokensK: 16, originalMessageCount: 1, originalTokens: 30 },
      messages: [{ id: 'summary', role: 'user', content: 'Earlier report processed', createdAt }],
    },
  });

  expect(compacted.messages.map((message) => message.id)).not.toContain(mailboxMessageId(delivered.id));
  expect(compacted.mailboxDeliveries).toEqual([{ ...delivered, consumed: true }, pending]);
});
