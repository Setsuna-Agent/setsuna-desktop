import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openWorkspaceFileWithDefaultApp } from './workspace-file-opening.js';

describe('openWorkspaceFileWithDefaultApp', () => {
  it('opens an existing workspace file through the supplied platform adapter', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-open-workspace-file-'));
    await mkdir(path.join(workspaceRoot, 'src'));
    const targetPath = path.join(workspaceRoot, 'src', 'main.ts');
    await writeFile(targetPath, 'export {};\n');
    const openPath = vi.fn(async () => '');

    await expect(openWorkspaceFileWithDefaultApp(workspaceRoot, 'src/main.ts', openPath)).resolves.toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(await realpath(targetPath));
  });

  it('rejects paths and symlinks that escape the workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-open-workspace-file-root-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-open-workspace-file-outside-'));
    const outsideFile = path.join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'secret\n');
    await symlink(outsideRoot, path.join(workspaceRoot, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir');
    const openPath = vi.fn(async () => '');

    await expect(openWorkspaceFileWithDefaultApp(workspaceRoot, '../secret.txt', openPath)).resolves.toMatchObject({ ok: false });
    await expect(openWorkspaceFileWithDefaultApp(workspaceRoot, 'linked-outside/secret.txt', openPath)).resolves.toEqual({
      ok: false,
      error: 'File path must stay inside the workspace.',
    });
    expect(openPath).not.toHaveBeenCalled();
  });
});
