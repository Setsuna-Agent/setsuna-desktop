import type { WorkspaceFileChange } from '@setsuna-desktop/contracts';
import { chmod, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLocalPatch, deleteLocalFile, editLocalFile, writeLocalFile, type PcLocalFileState } from '../../../src/adapters/tool/pc-local/pc-local-tool-files.js';
import { applyWorkspaceFileChanges } from '../../../src/adapters/workspace/workspace-file-changes.js';
import { createFileChangePatch } from '../../../src/utils/file-change-patch.js';

describe('workspace operation undo', () => {
  let root: string;
  let state: PcLocalFileState;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-file-undo-')));
    state = { root, reads: new Map() };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('undoes an edit to an existing untracked file without deleting it or resetting other edits', async () => {
    const before = '# 游戏中心 · 本地小游戏合集\n\nPreviously written content\n';
    await writeFile(path.join(root, 'README.md'), before);
    await writeFile(path.join(root, 'index.html'), 'separate unsaved work\n');
    const result = await editLocalFile({ file_path: 'README.md', old_string: before.split('\n')[0], new_string: '# 游戏中心' }, state);
    const changes = capturedChanges(result);
    await applyWorkspaceFileChanges(root, changes, 'undo');
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(before);
    expect(await readFile(path.join(root, 'index.html'), 'utf8')).toBe('separate unsaved work\n');
    await expect(applyWorkspaceFileChanges(root, changes, 'undo')).rejects.toThrow('No files were changed');
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(before);
    await applyWorkspaceFileChanges(root, changes, 'redo');
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(before.replace(before.split('\n')[0], '# 游戏中心'));
    await applyWorkspaceFileChanges(root, changes, 'undo');
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(before);
  });

  it('reverses multiple writes and patch moves in order, preserving raw text and empty-file existence', async () => {
    const original = '\uFEFF标题 😃\r\nsecond\nlast\r';
    await writeFile(path.join(root, 'note.txt'), original);
    await writeFile(path.join(root, 'empty.txt'), '');
    const first = await writeLocalFile({ file_path: 'note.txt', content: 'one\ntwo\n' }, state);
    const moved = await applyLocalPatch({ patch: '*** Begin Patch\n*** Update File: note.txt\n*** Move to: moved.txt\n@@\n-one\n+changed\n two\n*** End Patch' }, state);
    const empty = await deleteLocalFile({ file_path: 'empty.txt' }, state);
    const changes = [...capturedChanges(first), ...capturedChanges(moved), ...capturedChanges(empty)];
    await applyWorkspaceFileChanges(root, changes, 'undo');
    expect(await readFile(path.join(root, 'note.txt'), 'utf8')).toBe(original);
    expect(await readFile(path.join(root, 'empty.txt'), 'utf8')).toBe('');
    await expect(lstat(path.join(root, 'moved.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await applyWorkspaceFileChanges(root, changes, 'redo');
    expect(await readFile(path.join(root, 'moved.txt'), 'utf8')).toBe('changed\ntwo\n');
    await expect(lstat(path.join(root, 'note.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(root, 'empty.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks the entire batch before restoring or deleting anything when one file has newer edits', async () => {
    const created = await writeLocalFile({ file_path: 'new.txt', content: 'generated\n' }, state);
    await writeFile(path.join(root, 'existing.txt'), 'before\n');
    const edited = await writeLocalFile({ file_path: 'existing.txt', content: 'after\n' }, state);
    await writeFile(path.join(root, 'new.txt'), 'generated\nuser addition\n');
    await expect(applyWorkspaceFileChanges(root, [...capturedChanges(created), ...capturedChanges(edited)], 'undo'))
      .rejects.toThrow('No files were changed');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('generated\nuser addition\n');
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('after\n');
  });

  it('cancels the whole reapply if any file was edited or a removed path was recreated after undo', async () => {
    const created = await writeLocalFile({ file_path: 'new.txt', content: 'generated\n' }, state);
    await writeFile(path.join(root, 'existing.txt'), 'before\n');
    const edited = await writeLocalFile({ file_path: 'existing.txt', content: 'after\n' }, state);
    const changes = [...capturedChanges(created), ...capturedChanges(edited)];
    await applyWorkspaceFileChanges(root, changes, 'undo');
    await writeFile(path.join(root, 'existing.txt'), 'user edit after undo\n');
    await expect(applyWorkspaceFileChanges(root, changes, 'redo')).rejects.toThrow('No files were changed');
    // The valid first operation must not create its file when a later operation conflicts.
    await expect(lstat(path.join(root, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('user edit after undo\n');

    await writeFile(path.join(root, 'existing.txt'), 'before\n');
    await writeFile(path.join(root, 'new.txt'), 'user created file');
    await expect(applyWorkspaceFileChanges(root, changes, 'redo')).rejects.toThrow('No files were changed');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('user created file');
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('before\n');
  });

  it('restores deletions only if the path is still absent and serializes repeated undo requests', async () => {
    await writeFile(path.join(root, 'deleted.txt'), 'original');
    const deleted = capturedChanges(await deleteLocalFile({ file_path: 'deleted.txt' }, state));
    await writeFile(path.join(root, 'deleted.txt'), 'replacement');
    await expect(applyWorkspaceFileChanges(root, deleted, 'undo')).rejects.toThrow('No files were changed');
    expect(await readFile(path.join(root, 'deleted.txt'), 'utf8')).toBe('replacement');
    await rm(path.join(root, 'deleted.txt'));
    const results = await Promise.allSettled([applyWorkspaceFileChanges(root, deleted, 'undo'), applyWorkspaceFileChanges(root, deleted, 'undo')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await readFile(path.join(root, 'deleted.txt'), 'utf8')).toBe('original');
  });

  it('does not offer lossy restoration for binary deletes, including apply_patch and legacy deletion records', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x41, 0x00]);
    await writeFile(path.join(root, 'binary.dat'), bytes);
    const deleted = await deleteLocalFile({ file_path: 'binary.dat' }, state);
    expect(deleted).toMatchObject({ ok: true, diff: { action: 'Deleted', undo: undefined } });
    await expect(lstat(path.join(root, 'binary.dat'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path.join(root, 'binary.dat'), bytes);
    const patchDeleted = await applyLocalPatch({ patch: '*** Begin Patch\n*** Delete File: binary.dat\n*** End Patch' }, state);
    expect(patchDeleted).toMatchObject({ ok: true, diff: { action: 'Deleted', undo: undefined } });

    const created = capturedChanges(await writeLocalFile({ file_path: 'safe.txt', content: 'keep' }, state));
    const legacy = { path: 'binary.dat', patch: createFileChangePatch(bytes.toString('utf8'), null) };
    await expect(applyWorkspaceFileChanges(root, [legacy, ...created], 'undo')).rejects.toThrow('No files were changed');
    await expect(lstat(path.join(root, 'binary.dat'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(root, 'safe.txt'), 'utf8')).toBe('keep');
  });

  it.skipIf(process.platform === 'win32')('preserves script permissions through deletion and move undo/redo, and rejects newer chmod changes', async () => {
    const script = path.join(root, 'run.sh');
    const content = '#!/bin/sh\necho before\n';
    for (const remove of [
      () => deleteLocalFile({ file_path: 'run.sh' }, state),
      () => applyLocalPatch({ patch: '*** Begin Patch\n*** Delete File: run.sh\n*** End Patch' }, state),
    ]) {
      await writeFile(script, content);
      await chmod(script, 0o755);
      const changes = capturedChanges(await remove());
      expect(changes[0].patch.beforeMode).toBe(0o755);
      await applyWorkspaceFileChanges(root, changes, 'undo');
      expect(await readFile(script, 'utf8')).toBe(content);
      expect((await lstat(script)).mode & 0o777).toBe(0o755);
      await chmod(script, 0o644);
      await expect(applyWorkspaceFileChanges(root, changes, 'redo')).rejects.toThrow('No files were changed');
      expect((await lstat(script)).mode & 0o777).toBe(0o644);
      await chmod(script, 0o755);
      await applyWorkspaceFileChanges(root, changes, 'redo');
      await applyWorkspaceFileChanges(root, changes, 'undo');
      expect((await lstat(script)).mode & 0o777).toBe(0o755);
    }
    const moved = capturedChanges(await applyLocalPatch({ patch: '*** Begin Patch\n*** Update File: run.sh\n*** Move to: moved.sh\n@@\n-echo before\n+echo after\n*** End Patch' }, state));
    expect((await lstat(path.join(root, 'moved.sh'))).mode & 0o777).toBe(0o755);
    await applyWorkspaceFileChanges(root, moved, 'undo');
    expect((await lstat(script)).mode & 0o777).toBe(0o755);
    await applyWorkspaceFileChanges(root, moved, 'redo');
    expect((await lstat(path.join(root, 'moved.sh'))).mode & 0o777).toBe(0o755);
  });

  it('rejects invalid paths, symlinks and corrupt restoration data before touching files', async () => {
    await writeFile(path.join(root, 'target.txt'), 'after');
    const patch = createFileChangePatch('before', 'after');
    for (const unsafe of ['../outside.txt', '/', 'C:\\outside.txt', '.']) {
      await expect(applyWorkspaceFileChanges(root, [{ path: unsafe, patch }], 'undo')).rejects.toThrow();
    }
    await expect(applyWorkspaceFileChanges(root, [{ path: 'target.txt', patch: { ...patch, insert: 'wrong' } }], 'undo'))
      .rejects.toThrow('No files were changed');
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'target.txt'), path.join(root, 'link.txt'));
      await expect(applyWorkspaceFileChanges(root, [{ path: 'link.txt', patch }], 'undo')).rejects.toThrow('regular text files');
      const deletedLink = await deleteLocalFile({ file_path: 'link.txt' }, state);
      expect(deletedLink).toMatchObject({ diff: { undo: undefined } });
    }
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('after');
    const legacy = [{ path: 'target.txt', patch: { ...patch, removed: undefined } }];
    await applyWorkspaceFileChanges(root, legacy, 'undo');
    await expect(applyWorkspaceFileChanges(root, legacy, 'redo')).rejects.toThrow('No files were changed');
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('before');
  });
});

function capturedChanges(result: unknown): WorkspaceFileChange[] {
  const value = JSON.parse(JSON.stringify(result));
  expect(value.ok).toBe(true);
  const diffs = value.diff.diffs ?? [value.diff];
  return diffs.map((diff: { path: string; undo: WorkspaceFileChange['patch'] }) => ({ path: diff.path, patch: diff.undo }));
}
