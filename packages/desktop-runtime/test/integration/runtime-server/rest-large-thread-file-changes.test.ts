import { FILE_DIFF_PREVIEW_LINES, messageFileChangeGroupId, projectFileChangePreview, threadFileChangeKey, type RuntimeMessage, type RuntimeMessagePage, type RuntimeThread, type ThreadFileChangesResult, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { applyLocalPatch, editLocalFile } from '../../../src/adapters/tool/pc-local/pc-local-tool-files.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it.each(['long_turn', undefined])('undoes and reapplies both ends of a paginated 430-message turn after restarting (turnId: %s)', async (turnId) => {
  const harness = await createRuntimeServerTestHarness();
  try {
    // Preview requests use recorded paths; macOS temp roots can alias /private/var.
    const root = path.join(await realpath(harness.runtimeDataDir), 'large-turn-project');
    await mkdir(root);
    const project: WorkspaceProject = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: root }) });
    const edits = await Promise.all(['early.txt', 'late.txt'].map(async (file) => {
      await writeFile(path.join(root, file), 'before\n');
      return editLocalFile({ file_path: file, old_string: 'before', new_string: 'after' }, { root, reads: new Map() });
    }));
    await harness.server.close();
    const store = new SqliteThreadStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock, new RandomIdGenerator());
    let threadId: string;
    try {
      threadId = (await store.createThread({ title: 'Long turn file operations', projectId: project.id })).id;
      const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
        id: `message_${index}`, turnId, role: index === 0 ? 'user' : 'assistant', status: 'complete',
        content: `Progress ${index}`, createdAt: '2026-10-18T00:00:00Z', phase: index === 429 ? 'final_answer' : 'commentary',
        toolRuns: index === 1 || index === 428 ? [{
          id: index === 1 ? 'early_edit' : 'late_edit', name: 'edit', status: 'success', data: edits[index === 1 ? 0 : 1],
        }] : [],
      }));
      await store.appendEvents(threadId, messages.map((message) => ({
        id: `event_${message.id}`, threadId, turnId, type: 'message.created' as const,
        createdAt: message.createdAt, payload: { message },
      })));
    } finally { await store.close(); }
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const page: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    expect(page.messages).toHaveLength(160);
    expect(page.messages.some((message) => message.id === 'message_1')).toBe(false);
    const groupId = messageFileChangeGroupId(page.messages[0])!;
    expect(groupId).toBe(turnId ?? 'legacy:message_1');
    const ids = page.fileChangeGroups![groupId].map(({ run }) => run.id);
    expect(ids).toEqual(['early_edit', 'late_edit']);
    const previewInput = { path: path.join(root, 'early.txt'), toolCallIds: ['early_edit'] };
    const previewRequest = { method: 'POST', body: JSON.stringify(previewInput) };
    const preview = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, previewRequest);
    expect(preview).toMatchObject([{ messageId: 'message_1', run: { id: 'early_edit', data: { diff: { diffs: [{
      path: 'early.txt', additions: 1, deletions: 1, lines: [{ content: 'before' }, { content: 'after' }],
    }] } } } }]);
    expect(JSON.stringify(preview)).not.toContain('undo');
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, {
      method: 'POST', body: JSON.stringify({ ...previewInput, toolCallIds: ['missing_operation'] }),
    })).rejects.toThrow('no longer available');
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, {
      method: 'POST', body: JSON.stringify({ ...previewInput, path: path.join(root, 'late.txt') }),
    })).rejects.toThrow('no longer available');
    await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, {
      method: 'POST', body: JSON.stringify({ toolCallIds: [] }),
    })).rejects.toThrow('recorded file path');
    await expect(harness.runtimeFetch('/v1/threads/missing_thread/file-changes/preview', previewRequest)).rejects.toThrow('Thread not found');
    const request = { method: 'POST', body: JSON.stringify({ toolCallIds: ids }) };
    const undo: ThreadFileChangesResult = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, request);
    expect(await Promise.all(['early.txt', 'late.txt'].map((file) => readFile(path.join(root, file), 'utf8')))).toEqual(['before\n', 'before\n']);
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const reopened: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
    expect(messageFileChangeGroupId(reopened.messages[0])).toBe(groupId);
    const recoveredIds = reopened.fileChangeGroups![groupId].map(({ run }) => run.id);
    expect(recoveredIds).toEqual(ids);
    expect(await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, previewRequest)).toEqual(preview);
    expect(reopened.fileChangeStates?.[threadFileChangeKey(recoveredIds)]).toEqual(undo.state);
    const older: RuntimeMessagePage = await harness.runtimeFetch(`/v1/threads/${threadId}/messages?before=270&limit=160`);
    expect(messageFileChangeGroupId(older.messages[0])).toBe(groupId);
    expect(older.fileChangeGroups![groupId].map(({ run }) => run.id)).toEqual(ids);
    await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/redo`, { method: 'POST', body: JSON.stringify({ toolCallIds: recoveredIds }) });
    expect(await Promise.all(['early.txt', 'late.txt'].map((file) => readFile(path.join(root, file), 'utf8')))).toEqual(['after\n', 'after\n']);
  } finally { await harness.close(); }
});

it.each([
  ['structured', 1], ['structured', 428], ['preview-only', 1], ['preview-only', 428],
] as const)('keeps later patch files readable after paging, checkpointing and restarting a %s history at message %s', async (source, messageIndex) => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const root = path.join(await realpath(harness.runtimeDataDir), 'multi-file-project');
    await mkdir(root);
    const project: WorkspaceProject = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: root }) });
    const smallPath = path.join(root, 'small.txt');
    const largePath = path.join(root, 'large.txt');
    await writeFile(smallPath, 'before\n');
    const patch = ['*** Begin Patch', '*** Add File: large.txt',
      ...Array.from({ length: FILE_DIFF_PREVIEW_LINES }, (_, index) => `+created ${index}`),
      '*** Update File: small.txt', '@@', '-before', '+after', '*** End Patch',
    ].join('\n');
    const result = await applyLocalPatch({ patch }, { root, reads: new Map() });
    expect(result).toMatchObject({ ok: true });
    expect(await readFile(smallPath, 'utf8')).toBe('after\n');
    await harness.server.close();
    const store = new SqliteThreadStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock, new RandomIdGenerator());
    let threadId: string;
    try {
      threadId = (await store.createThread({ title: 'Multiple file previews', projectId: project.id })).id;
      const messages: RuntimeMessage[] = Array.from({ length: 430 }, (_, index) => ({
        id: `message_${index}`, turnId: 'turn', role: index === 0 ? 'user' : 'assistant', status: 'complete',
        content: `Progress ${index}`, createdAt: '2026-10-18T00:00:00Z', phase: index === 429 ? 'final_answer' : 'commentary',
        toolRuns: index === messageIndex ? [{ id: 'patch', name: 'apply_patch', status: 'success',
          resultPreview: JSON.stringify(result), ...(source === 'structured' ? { data: result } : {}),
        }] : [],
      }));
      await store.appendEvents(threadId, messages.map((message) => ({
        id: `event_${message.id}`, threadId, turnId: 'turn', type: 'message.created' as const,
        createdAt: message.createdAt, payload: { message },
      })));
    } finally { await store.close(); }

    for (let restart = 0; restart < 2; restart += 1) {
      await harness.startRuntimeServer(harness.runtimeDataDir);
      const page: RuntimeThread = await harness.runtimeFetch(`/v1/threads/${threadId}?messageLimit=160`);
      expect(page.messages).toHaveLength(160);
      expect(page.messages.some((message) => message.id === 'message_1')).toBe(false);
      expect(page.fileChangeGroups!.turn.map(({ run }) => run.id)).toEqual(['patch']);
      if (messageIndex === 428) {
        expect(projectFileChangePreview(page.messages, { path: smallPath, toolCallIds: ['patch'] }))
          .toMatchObject([{ run: { data: { diff: { diffs: [{ path: 'small.txt', lines: [], truncated: true }] } } } }]);
      }
      const preview = await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/preview`, {
        method: 'POST', body: JSON.stringify({ path: smallPath, toolCallIds: ['patch'] }),
      });
      expect(preview).toMatchObject([{ messageId: `message_${messageIndex}`, run: { id: 'patch', data: { diff: { diffs: [{
        path: 'small.txt', additions: 1, deletions: 1, truncated: false,
        lines: [{ type: 'del', content: 'before' }, { type: 'add', content: 'after' }],
      }] } } } }]);
      expect(JSON.stringify(preview)).not.toContain('undo');
      expect(JSON.stringify(preview)).not.toContain('created 0');
      if (restart === 0) {
        // Persist the reloaded storage projection; the next restart must still
        // serve the second file, even after a display response was requested.
        await harness.runtimeFetch(`/v1/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Checkpoint previews' }) });
        await harness.server.close();
      }
    }
    const operation = { method: 'POST', body: JSON.stringify({ toolCallIds: ['patch'] }) };
    if (source === 'preview-only') {
      // Legacy display JSON is readable, but must not become an authoritative
      // undo source merely because its preview is now retained per file.
      await expect(harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, operation)).rejects.toThrow('no complete change record');
      expect(await readFile(smallPath, 'utf8')).toBe('after\n');
      expect((await readFile(largePath, 'utf8')).trimEnd().split('\n')).toHaveLength(FILE_DIFF_PREVIEW_LINES);
      return;
    }
    await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/undo`, operation);
    expect(await readFile(smallPath, 'utf8')).toBe('before\n');
    await expect(readFile(largePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await harness.runtimeFetch(`/v1/threads/${threadId}/file-changes/redo`, operation);
    expect(await readFile(smallPath, 'utf8')).toBe('after\n');
    expect((await readFile(largePath, 'utf8')).trimEnd().split('\n')).toHaveLength(FILE_DIFF_PREVIEW_LINES);
  } finally { await harness.close(); }
});
