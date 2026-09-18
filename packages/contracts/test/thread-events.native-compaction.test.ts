import { describe, expect, it } from 'vitest';
import { restoreNativeCompactionHistory } from '../src/event-projections/native-compaction.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeMessage, RuntimeThread } from '../src/threads.js';

describe('native compaction message deletion', () => {
  it.each([
    { deleted: ['source_2'], restored: ['source_1', 'source_3'] },
    { deleted: ['first'], restored: ['source_1', 'source_2', 'source_3'] },
    { deleted: ['first', 'source_1'], restored: ['source_2', 'source_3'] },
    { deleted: ['source_1', 'source_2', 'source_3'], restored: [] },
  ])('removes affected opaque state and restores surviving history: $deleted', ({ deleted, restored }) => {
    const thread = history();
    const before = structuredClone(thread);
    const projected = applyRuntimeEventToThread(thread, {
      id: 'delete', seq: 2, threadId: thread.id, type: 'messages.deleted', createdAt: thread.updatedAt,
      payload: { messageIds: deleted },
    });
    expect(projected.messages.filter((message) => message.visibility !== 'transcript').map((message) => message.id))
      .toEqual([...restored, 'independent', 'recent']);
    expect(projected.messages.some((message) => ['first', 'second', ...deleted].includes(message.id))).toBe(false);
    expect(projected.messages.find((message) => message.id === 'independent')).toBe(thread.messages.find((message) => message.id === 'independent'));
    expect(projected.contextCompaction).toBeUndefined();
    expect(projected.contextBudgetInvalidatedAtSeq).toBe(2);
    expect(projected.turns).toEqual([]);
    // A later model switch can expand every remaining checkpoint without missing references.
    expect(restoreNativeCompactionHistory(projected.messages).filter((message) => message.visibility !== 'transcript').map((message) => message.id))
      .toEqual([...restored, 'source_4', 'recent']);
    expect(thread).toEqual(before);
  });

  it('restores surviving archived history when truncation removes its checkpoint', () => {
    const thread = history();
    const projected = applyRuntimeEventToThread(thread, {
      id: 'truncate', seq: 2, threadId: thread.id, type: 'messages.truncated', createdAt: thread.updatedAt,
      payload: { messageId: 'source_2', removedMessageIds: thread.messages.slice(2).map((message) => message.id) },
    });
    expect(projected.messages.map((message) => [message.id, message.visibility])).toEqual([
      ['source_1', undefined], ['source_2', undefined],
    ]);
  });
});

function history(): RuntimeThread {
  const first = checkpoint('first', ['source_1', 'source_2'], 'transcript');
  const second = checkpoint('second', ['first', 'source_3']);
  return {
    id: 'thread', title: 'History', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z',
    archived: false, lastSeq: 1, messageCount: 8, lastMessagePreview: 'recent',
    messages: [source('source_1'), source('source_2'), first, source('source_3'), second,
      source('source_4'), checkpoint('independent', ['source_4']), { ...source('recent'), visibility: undefined }],
    contextCompaction: { status: 'completed', notice: second.contextCompaction },
    turns: [{ id: 'first', status: 'completed', items: [] }, { id: 'second', status: 'completed', items: [] }],
  };
}

function source(id: string): RuntimeMessage {
  return { id, role: 'user', content: `Content ${id}`, createdAt: '2026-09-17T00:00:00.000Z', visibility: 'transcript' };
}

function checkpoint(id: string, ids: string[], visibility?: RuntimeMessage['visibility']): RuntimeMessage {
  return {
    ...source(id), turnId: id, visibility,
    contextCompaction: {
      nativeSourceMessageIds: ids, compactedMessageCount: ids.length, compactedTokens: 10, keptRecentMessageCount: 0,
      maxContextTokensK: 64, originalMessageCount: ids.length, originalTokens: 100, source: 'remote',
    },
    providerMetadata: {
      schemaVersion: 3,
      source: { providerId: 'provider', providerKind: 'openai-responses', model: 'model', endpointFingerprint: 'a'.repeat(64) },
      openAiResponsesCompaction: { items: [{ type: 'compaction', encrypted_content: `opaque-${id}` }] },
    },
  };
}
