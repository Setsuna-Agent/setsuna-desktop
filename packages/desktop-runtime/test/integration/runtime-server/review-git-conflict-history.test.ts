import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ReviewConflictTaskStore } from '../../../src/adapters/feature/review-conflict-task-store.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('restores per-workspace conflict history and transcripts across startup cleanup, including interrupted tasks', async () => {
  const harness = await createRuntimeServerTestHarness();
  const root = harness.runtimeDataDir;
  const repo = path.join(root, 'repository');
  const other = path.join(root, 'other');
  await Promise.all([mkdir(repo), mkdir(other)]);
  try {
    await harness.server.close();
    const threads = createTestThreadStore(path.join(root, 'runtime'), systemClock, new RandomIdGenerator());
    const index = new ReviewConflictTaskStore(path.join(root, 'runtime'), threads);
    const parent = await threads.createThread({ title: 'Main conversation' });
    const transient = await threads.createThread({ kind: 'side', forkedFromId: parent.id });
    const records = [];
    try {
      for (const [operation, workspaceRoot] of [['pull', repo], ['rebase', repo], ['sync', other]] as const) {
        const thread = await threads.createThread({ kind: 'side', memoryMode: 'disabled', title: 'Git 冲突解决' });
        const turnId = `turn_${operation}`;
        await index.retain({ threadId: thread.id, createdAt: thread.createdAt, operation, workspaceRoot: await realpath(workspaceRoot) });
        await threads.appendEvent(thread.id, { id: `start_${operation}`, threadId: thread.id, turnId, type: 'turn.started', createdAt: thread.createdAt, payload: { input: 'Resolve conflicts' } });
        await threads.appendEvent(thread.id, {
          id: `message_${operation}`, threadId: thread.id, turnId, type: 'message.created', createdAt: thread.createdAt,
          payload: { message: { id: `msg_${operation}`, turnId, role: 'assistant', content: `${operation}: retained repair details`, createdAt: thread.createdAt, status: 'complete' } },
        });
        if (operation !== 'rebase') {
          await threads.appendEvent(thread.id, { id: `finish_${operation}`, threadId: thread.id, turnId, type: 'turn.completed', createdAt: thread.createdAt, payload: {} });
        }
        records.push({ threadId: thread.id, turnId, createdAt: thread.createdAt, operation });
      }
    } finally { await threads.close(); }

    // Use the real server startup, including stale-turn settlement and the Side
    // Conversation Feature's cleanup, rather than merely rereading an index file.
    await harness.startRuntimeServer(root);
    const history = await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history?workspaceRoot=${encodeURIComponent(repo)}`);
    expect(history).toHaveLength(2);
    expect(history).toEqual(expect.arrayContaining(records.slice(0, 2)));
    const otherHistory = await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history?workspaceRoot=${encodeURIComponent(other)}`);
    expect(otherHistory).toEqual([records[2]]);
    const list = await harness.runtimeFetch('/v1/threads');
    expect(list.threads.map((thread: { id: string }) => thread.id)).toEqual([parent.id]);
    for (const record of records) {
      const restored = await harness.runtimeFetch(`/v1/threads/${record.threadId}`);
      expect(restored.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: `${record.operation}: retained repair details` })]));
      expect(restored.activeTurnId).toBeFalsy();
      expect(restored.turns[0].status).toBe(record.operation === 'rebase' ? 'cancelled' : 'completed');
    }
    await expect(harness.runtimeFetch(`/v1/threads/${transient.id}`)).rejects.toThrow();
    const target = records[0];
    const archivePath = `/v1/features/desktop-review/git-conflicts/history/${target.threadId}`;
    const setArchived = (workspaceRoot: string, archived: boolean) => harness.runtimeFetch(archivePath, {
      method: 'PATCH', body: JSON.stringify({ workspaceRoot, archived }),
    });
    // A valid thread ID from another workspace cannot mutate that project's history.
    await expect(setArchived(other, true)).rejects.toThrow('Conflict task was not found in this workspace.');
    expect(await setArchived(repo, true)).toEqual({ ...target, archived: true });
    expect(await setArchived(repo, true)).toEqual({ ...target, archived: true });
    const otherTarget = records[2];
    await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history/${otherTarget.threadId}`, {
      method: 'PATCH', body: JSON.stringify({ workspaceRoot: other, archived: true }),
    });
    const expectedArchives = [
      { ...target, archived: true, workspaceRoot: await realpath(repo) },
      { ...otherTarget, archived: true, workspaceRoot: await realpath(other) },
    ];
    expect(await harness.runtimeFetch('/v1/features/desktop-review/git-conflicts/archives'))
      .toEqual(expect.arrayContaining(expectedArchives));

    await harness.server.close();
    await harness.startRuntimeServer(root);
    const archivedHistory = await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history?workspaceRoot=${encodeURIComponent(repo)}`);
    expect(archivedHistory).toEqual(history.map((record: { threadId: string }) => record.threadId === target.threadId ? { ...record, archived: true } : record));
    const settingsArchives = await harness.runtimeFetch('/v1/features/desktop-review/git-conflicts/archives');
    expect(settingsArchives).toHaveLength(2);
    expect(settingsArchives).toEqual(expect.arrayContaining(expectedArchives));
    const retained = await harness.runtimeFetch(`/v1/threads/${target.threadId}`);
    expect(retained.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'pull: retained repair details' })]));
    expect(await setArchived(repo, false)).toEqual({ ...target, archived: false });
    await harness.server.close();
    await harness.startRuntimeServer(root);
    expect(await harness.runtimeFetch('/v1/features/desktop-review/git-conflicts/archives')).toEqual([expectedArchives[1]]);
    const restoredHistory = await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history?workspaceRoot=${encodeURIComponent(repo)}`);
    expect(restoredHistory).toEqual(history.map((record: { threadId: string }) => record.threadId === target.threadId ? { ...record, archived: false } : record));
    expect((await harness.runtimeFetch('/v1/threads')).threads.map((thread: { id: string }) => thread.id)).toEqual([parent.id]);

    const deleteArchive = (threadId: string, workspaceRoot: string) => harness.runtimeFetch(
      `/v1/features/desktop-review/git-conflicts/history/${threadId}?workspaceRoot=${encodeURIComponent(workspaceRoot)}`,
      { method: 'DELETE' },
    );
    await expect(deleteArchive(target.threadId, repo)).rejects.toThrow('Only archived conflict records');
    expect(await deleteArchive(parent.id, repo)).toEqual({ deleted: false });
    expect(await deleteArchive(otherTarget.threadId, repo)).toEqual({ deleted: false });
    expect((await harness.runtimeFetch(`/v1/threads/${parent.id}`)).id).toBe(parent.id);
    expect((await harness.runtimeFetch(`/v1/threads/${target.threadId}`)).id).toBe(target.threadId);
    // The archived project may have moved. Deletion only tears down its hidden
    // task and index, never the project directory or the Git changes inside it.
    await writeFile(path.join(other, 'project.txt'), 'Keep project files');
    await rename(other, `${other}-moved`);
    expect(await deleteArchive(otherTarget.threadId, expectedArchives[1].workspaceRoot)).toEqual({ deleted: true });
    expect(await deleteArchive(otherTarget.threadId, expectedArchives[1].workspaceRoot)).toEqual({ deleted: false });
    await expect(harness.runtimeFetch(`/v1/threads/${otherTarget.threadId}`)).rejects.toThrow();
    expect(await index.retainedThreadIds()).not.toContain(otherTarget.threadId);
    expect(await readFile(path.join(`${other}-moved`, 'project.txt'), 'utf8')).toBe('Keep project files');
    await harness.server.close();
    await harness.startRuntimeServer(root);
    expect(await harness.runtimeFetch('/v1/features/desktop-review/git-conflicts/archives')).toEqual([]);
    await expect(harness.runtimeFetch(`/v1/threads/${otherTarget.threadId}`)).rejects.toThrow();
    expect(await harness.runtimeFetch(`/v1/features/desktop-review/git-conflicts/history?workspaceRoot=${encodeURIComponent(repo)}`)).toEqual(restoredHistory);
  } finally { await harness.close(); }
});
