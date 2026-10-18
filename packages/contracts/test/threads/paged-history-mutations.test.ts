import { expect, it } from 'vitest';
import { applyRuntimeEventToThread } from '../../src/thread-events.js';
import type { RuntimeThread, StoredThreadEvent } from '../../src/index.js';

it('uses persisted removed IDs when the truncation anchor is before the loaded page', () => {
  const thread = snapshot();
  const next = applyRuntimeEventToThread(thread, truncated(['hidden_edit', 'tail']));
  expect(next.messages.map((message) => message.id)).toEqual(['survivor']);
  expect(next.fileChangeGroups?.turn).toEqual([]);
  expect(next.contextBudgetInvalidatedAtSeq).toBe(11);
  expect(next.lastSeq).toBe(11);
  expect(thread.messages).toHaveLength(2);
  expect(thread.fileChangeGroups?.turn).toHaveLength(1);
});

it('does not remove retained messages merely because they follow the anchor in this projection', () => {
  const thread = snapshot();
  const event = truncated(['tail']);
  event.payload.messageId = 'survivor';
  event.payload.includeSelf = true;
  expect(applyRuntimeEventToThread(thread, event).messages.map((message) => message.id)).toEqual(['survivor']);
});

it('still replays legacy truncations without a removal list using their loaded anchor', () => {
  const event = truncated(['tail']);
  event.payload.messageId = 'survivor';
  delete (event.payload as Partial<typeof event.payload>).removedMessageIds;
  expect(applyRuntimeEventToThread(snapshot(), event).messages.map((message) => message.id)).toEqual(['survivor']);
});

function truncated(removedMessageIds: string[]): Extract<StoredThreadEvent, { type: 'messages.truncated' }> {
  return { id: 'truncate', threadId: 'thread', type: 'messages.truncated', seq: 11, createdAt: '',
    payload: { messageId: 'unloaded_prompt', removedMessageIds },
  };
}
function snapshot(): RuntimeThread {
  return { id: 'thread', title: '', createdAt: '', updatedAt: '', archived: false, lastSeq: 10, messageCount: 430, lastMessagePreview: '',
    messagePage: { total: 430, nextBefore: 270 },
    messages: ['survivor', 'tail'].map((id) => ({ id, role: 'assistant', content: id, createdAt: '' })),
    fileChangeGroups: { turn: [{ messageId: 'hidden_edit', run: { id: 'edit', name: 'edit', status: 'success' } }] },
  };
}
