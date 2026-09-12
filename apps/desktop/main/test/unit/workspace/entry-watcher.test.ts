import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { watchWorkspaceEntries } from '../../../src/workspace/entry-watcher.js';

it('notifies about external file creation, content edits, folder renames and deletions in listed directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-watch-events-'));
  await mkdir(path.join(root, 'src'));
  const changed = vi.fn();
  const dispose = await watchWorkspaceEntries(root, ['', 'src'], changed);
  try {
    await writeFile(path.join(root, 'README.md'), '# new');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await writeFile(path.join(root, 'src', 'nested.ts'), 'export {}');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await writeFile(path.join(root, 'src', 'nested.ts'), 'export const updated = true;');
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await rename(path.join(root, 'src'), path.join(root, 'lib'));
    await rm(path.join(root, 'README.md'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

it('limits every watched directory to the workspace, including symlink resolution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-tree-watch-'));
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  try {
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, path.join(workspace, 'link'), 'junction');
    for (const directoryPath of ['../outside', '..\\outside', outside, 'link']) {
      await expect(watchWorkspaceEntries(workspace, [directoryPath], vi.fn())).rejects.toThrow();
    }
    const dispose = await watchWorkspaceEntries(workspace, ['', 'already-deleted'], vi.fn());
    dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('attaches directories created after subscribing and reattaches when their inodes are replaced', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-watch-recreate-'));
  const directory = path.join(root, 'new-dir');
  const nested = path.join(directory, 'nested');
  const changed = vi.fn();
  const dispose = await watchWorkspaceEntries(root, ['', 'new-dir', 'new-dir/nested'], changed);
  const waitForChange = async () => {
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
  };
  try {
    await mkdir(directory);
    await waitForChange();
    await mkdir(nested);
    await waitForChange();
    await writeFile(path.join(nested, 'file.ts'), 'first');
    await waitForChange();

    // Keep the old inode alive at another path; subscriptions must follow the requested path.
    await rename(directory, path.join(root, 'old-dir'));
    await mkdir(nested, { recursive: true });
    await waitForChange();
    await writeFile(path.join(nested, 'file.ts'), 'replacement');
    await waitForChange();
    await writeFile(path.join(nested, 'file.ts'), 'later edit');
    await waitForChange();

    await rm(directory, { recursive: true });
    await waitForChange();
    await mkdir(nested, { recursive: true });
    await waitForChange();
    await writeFile(path.join(nested, 'file.ts'), 'recreated');
    await waitForChange();
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});
