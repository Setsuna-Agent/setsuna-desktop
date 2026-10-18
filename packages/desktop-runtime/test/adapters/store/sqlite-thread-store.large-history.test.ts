import type { PendingStoredThreadEvent, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { messageFileChangeGroupId, threadFileChangeKey } from '@setsuna-desktop/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { applyFileChangePatch, createFileChangePatch } from '../../../src/utils/file-change-patch.js';

it.each(['long_turn', undefined])('opens, pages and continues an oversized conversation without shipping undo bodies (turnId: %s)', async (turnId) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-large-history-'));
  const createStore = () => new SqliteThreadStore(directory, systemClock, new RandomIdGenerator());
  let store = createStore();
  try {
    const thread = await store.createThread({ title: 'Legacy large conversation' });
    const text = 'original content\r\n'.repeat(16_475);
    const undo = { ...createFileChangePatch(text, null), beforeMode: 0o644 };
    const diff = { type: 'file_diff', action: 'Deleted', path: 'large.txt', additions: 0, deletions: 16_475, truncated: false, undo,
      lines: Array.from({ length: 16_475 }, (_, index) => ({ type: 'del', oldLine: index + 1, content: 'original content' })),
    };
    const legacyPreview = JSON.stringify({ diff });
    const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
      id: `message_${index}`, turnId, createdAt: thread.createdAt,
      role: index === 0 ? 'user' : 'assistant', phase: index === 429 ? 'final_answer' : 'commentary',
      content: index === 0 ? 'Keep working' : `Progress ${index}`, status: 'complete',
      ...(index === 1 ? { toolRuns: [{ id: 'early_edit', name: 'edit', status: 'success' as const, data: { ok: true, diff: { ...diff, path: 'early.txt' } } }] } : {}),
      ...(index === 426 ? { toolRuns: [{ id: 'delete_large', name: 'delete_file', status: 'success', data: { ok: true, diff }, resultPreview: legacyPreview }] } : {}),
    }));
    await store.appendEvents(thread.id, messages.map((message): PendingStoredThreadEvent => ({
      id: `created_${message.id}`, threadId: thread.id, turnId: message.turnId, createdAt: thread.createdAt,
      type: 'message.created', payload: { message },
    })));
    const toolCallIds = ['early_edit', 'delete_large'];
    await store.appendEvent(thread.id, {
      id: 'undo_all', threadId: thread.id, createdAt: thread.createdAt, type: 'thread.file_changes_applied',
      payload: { toolCallIds, action: 'undo' },
    });
    await store.close();
    store = createStore();
    await store.recover();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      expect(await store.getThreadMetadata(thread.id)).toMatchObject({ lastSeq: 432 });
      expect(clone).not.toHaveBeenCalled();
    } finally { clone.mockRestore(); }

    let page: RuntimeThread | null = await store.getThreadPage(thread.id, { limit: 160 });
    expect(page?.archived).toBe(false);
    expect(page!.messages).toHaveLength(160);
    const groupId = messageFileChangeGroupId(page!.messages[0])!;
    expect(groupId).toBe(turnId ?? 'legacy:message_1');
    expect(page!.fileChangeGroups?.[groupId].map(({ run }) => run.id)).toEqual(toolCallIds);
    expect(page!.fileChangeStates?.[threadFileChangeKey(toolCallIds)]).toEqual({ action: 'undo', seq: 432 });
    expect(JSON.stringify(page!.fileChangeGroups).length).toBeLessThan(1500);
    expect(JSON.stringify(page!.fileChangeGroups)).not.toContain('undo');
    expect(JSON.stringify(page).length).toBeLessThan(160_000);
    expect(page!.messages.find((message) => message.id === 'message_426')?.toolRuns?.[0].data).not.toHaveProperty('diff.undo');
    const previewClone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const preview = await store.getFileChangePreview(thread.id, { path: 'early.txt', toolCallIds: ['early_edit'] });
      expect(preview).toHaveLength(1);
      expect(JSON.stringify(preview).length).toBeLessThan(24_000);
      expect(preview![0].run.data).toMatchObject({ diff: { diffs: [{ path: 'early.txt', deletions: 16_475, truncated: true }] } });
      // The selected preview is bounded before cloning, even in an old full-history store.
      expect(previewClone).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(previewClone.mock.calls[0][0]).length).toBeLessThan(24_000);
      expect(JSON.stringify(preview)).not.toContain('undo');
    } finally { previewClone.mockRestore(); }
    let recovered: string[] = [];
    while (page) {
      expect(page.messages.length).toBeLessThanOrEqual(200);
      expect(page.fileChangeGroups?.[groupId].map(({ run }) => run.id)).toEqual(toolCallIds);
      expect(page.messages.filter((message) => message.role === 'assistant').every((message) => messageFileChangeGroupId(message) === groupId)).toBe(true);
      recovered = [...page.messages.map((message) => message.id), ...recovered];
      const before = page.messagePage!.nextBefore;
      page = before === null ? null : await store.getThreadPage(thread.id, { before, limit: 160 });
    }
    expect(recovered).toEqual(messages.map((message) => message.id));
    const full = (await store.getThread(thread.id))!;
    expect(full.messages.every((message) => !message.fileChangeGroupId && message.turnId === turnId)).toBe(true);
    const preserved = full.messages[426].toolRuns![0].data as { diff: { undo: typeof undo } };
    expect(applyFileChangePatch(null, preserved.diff.undo, 'undo')).toBe(text);
    expect(applyFileChangePatch(text, preserved.diff.undo, 'redo')).toBeNull();
    const events = await store.listEvents(thread.id);
    expect(events.find((event) => event.id === 'created_message_426')).toMatchObject({ payload: {
      message: { toolRuns: [{ resultPreview: legacyPreview, data: { diff: { lines: diff.lines } } }] },
    } });
    await store.appendEvent(thread.id, {
      id: 'new_message', threadId: thread.id, createdAt: thread.createdAt, type: 'message.created',
      payload: { message: { id: 'continued', role: 'user', content: 'Continue', createdAt: thread.createdAt, turnId: 'next_turn' } },
    });
    expect(await store.getThreadPage(thread.id, { limit: 160 })).toMatchObject({ lastSeq: 433, archived: false, messagePage: { total: 431 } });
    await store.close();
    store = createStore();
    const reopened = await store.getThreadPage(thread.id, { limit: 160 });
    expect(reopened!.messages.at(-1)?.id).toBe('continued');
    expect(JSON.stringify(reopened).length).toBeLessThan(160_000);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
