import { expect, it } from 'vitest';
import type { RuntimeEvent } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';
import { threadFileChangeKey } from '../src/workspace.js';

it('projects durable batch directions without mutating tool results, isolating other batches and clearing with history', () => {
  const thread: RuntimeThread = {
    id: 'thread', title: 'Files', createdAt: '', updatedAt: '', archived: false,
    messageCount: 0, lastMessagePreview: '', lastSeq: 0, messages: [],
  };
  const operation = (seq: number, ids: string[], action: 'undo' | 'redo'): RuntimeEvent => ({
    id: `event-${seq}`, threadId: thread.id, seq, createdAt: '', type: 'thread.file_changes_applied',
    payload: { toolCallIds: ids, action },
  });
  const first = applyRuntimeEventToThread(thread, operation(1, ['b', 'a', 'a'], 'undo'));
  const second = applyRuntimeEventToThread(first, operation(2, ['c'], 'undo'));
  const restored = JSON.parse(JSON.stringify(second)) as RuntimeThread;
  const reapplied = applyRuntimeEventToThread(restored, operation(3, ['a', 'b'], 'redo'));
  expect(reapplied.fileChangeStates).toEqual({
    [threadFileChangeKey(['b', 'a'])]: { action: 'redo', seq: 3 },
    [threadFileChangeKey(['c'])]: { action: 'undo', seq: 2 },
  });
  expect(first.fileChangeStates).toEqual({ '["a","b"]': { action: 'undo', seq: 1 } });
  expect(thread.fileChangeStates).toBeUndefined();
  expect(first.messages).toBe(thread.messages);
  const cleared = applyRuntimeEventToThread(reapplied, {
    id: 'clear', threadId: thread.id, seq: 4, createdAt: '', type: 'thread.context_cleared', payload: { clearedMessageCount: 0 },
  });
  expect(cleared.fileChangeStates).toBeUndefined();
});
