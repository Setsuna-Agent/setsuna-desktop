import { threadFileChangeKey, type RuntimeThread, type ThreadFileChangesResult, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { deleteLocalFile, editLocalFile } from '../../../src/adapters/tool/pc-local/pc-local-tool-files.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('restores persisted file edits and script deletions through REST, rejecting binary restoration and later changes', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const projectRoot = path.join(harness.runtimeDataDir, 'project');
    await mkdir(projectRoot);
    const project: WorkspaceProject = await harness.runtimeFetch('/v1/projects', {
      method: 'POST', body: JSON.stringify({ path: projectRoot }),
    });
    const original = '# 游戏中心 · 本地小游戏合集\r\n\r\nAll earlier contents\r\n';
    await writeFile(path.join(projectRoot, 'README.md'), original);
    const state = { root: projectRoot, reads: new Map() };
    const result = await editLocalFile({
      file_path: 'README.md', old_string: '# 游戏中心 · 本地小游戏合集', new_string: '# 游戏中心',
    }, state);
    expect(result.ok).toBe(true);
    const scriptPath = path.join(projectRoot, 'run.sh');
    const script = '#!/bin/sh\necho hello\n';
    await writeFile(scriptPath, script);
    await chmod(scriptPath, 0o755);
    const deleted = await deleteLocalFile({ file_path: 'run.sh' }, state);
    const binaryPath = path.join(projectRoot, 'binary.dat');
    await writeFile(binaryPath, Buffer.from([0xff, 0xfe]));
    const binaryDeleted = await deleteLocalFile({ file_path: 'binary.dat' }, state);
    const operations = [
      { id: 'call_edit', name: 'edit', data: result },
      { id: 'call_delete', name: 'delete_file', data: deleted },
      { id: 'call_binary', name: 'delete_file', data: binaryDeleted },
    ];
    const now = '2026-09-12T00:00:00.000Z';
    // Persist through the same event projection as tool execution, then reopen it through REST.
    await harness.server.close();
    const store = new SqliteThreadStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock, new RandomIdGenerator());
    let threadId: string;
    try {
      await store.recover();
      threadId = (await store.createThread({ title: 'Undo file edit', projectId: project.id })).id;
      await store.appendEvent(threadId, {
        id: 'event_message', threadId, type: 'message.created', createdAt: now,
        payload: { message: {
          id: 'message_edit', role: 'assistant', content: 'Edited README.md.', createdAt: now, status: 'complete',
          phase: 'final_answer', toolRuns: operations.map(({ id, name }) => ({ id, name, status: 'running' })),
        } },
      });
      for (const operation of operations) {
        await store.appendEvent(threadId, {
          id: `event_${operation.id}`, threadId, type: 'tool.completed', createdAt: now,
          payload: { toolCallId: operation.id, toolName: operation.name, status: 'success', content: 'File changed.', data: operation.data },
        });
      }
    } finally {
      await store.close();
    }
    await harness.startRuntimeServer(harness.runtimeDataDir);

    const input = { method: 'POST', body: JSON.stringify({ toolCallIds: ['call_edit', 'call_delete'] }) };
    const undone: ThreadFileChangesResult = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, input);
    expect(undone).toEqual({ files: ['README.md', 'run.sh'], state: { action: 'undo', seq: expect.any(Number) } });
    const batchKey = threadFileChangeKey(['call_edit', 'call_delete']);
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const restarted: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(restarted.fileChangeStates?.[batchKey]).toEqual(undone.state);
    expect(await readFile(path.join(projectRoot, 'README.md'), 'utf8')).toBe(original);
    expect(await readFile(scriptPath, 'utf8')).toBe(script);
    if (process.platform !== 'win32') expect((await lstat(scriptPath)).mode & 0o777).toBe(0o755);
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, input)).rejects.toThrow('conflict');
    expect(await readFile(path.join(projectRoot, 'README.md'), 'utf8')).toBe(original);
    const reapplied: ThreadFileChangesResult = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/redo`, input);
    expect(reapplied).toEqual({ files: ['README.md', 'run.sh'], state: { action: 'redo', seq: expect.any(Number) } });
    expect(reapplied.state.seq).toBeGreaterThan(undone.state.seq);
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const restartedAgain: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(restartedAgain.fileChangeStates?.[batchKey]).toEqual(reapplied.state);
    expect(await readFile(path.join(projectRoot, 'README.md'), 'utf8')).toBe(original.replace(' · 本地小游戏合集', ''));
    await expect(lstat(scriptPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const undoneAgain: ThreadFileChangesResult = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, input);
    await writeFile(path.join(projectRoot, 'README.md'), 'user edit after undo\n');
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/redo`, input)).rejects.toThrow('conflict');
    const conflicted: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}`);
    expect(conflicted.fileChangeStates?.[batchKey]).toEqual(undoneAgain.state);
    expect(await readFile(path.join(projectRoot, 'README.md'), 'utf8')).toBe('user edit after undo\n');
    expect(await readFile(scriptPath, 'utf8')).toBe(script);
    if (process.platform !== 'win32') expect((await lstat(scriptPath)).mode & 0o777).toBe(0o755);
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, {
      method: 'POST', body: JSON.stringify({ toolCallIds: ['call_binary'] }),
    })).rejects.toThrow('complete change record');
    await expect(lstat(binaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await harness.close();
  }
});
