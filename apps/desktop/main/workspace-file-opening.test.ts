import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  copyWorkspaceFilePath,
  createWorkspaceFilePreviewUrl,
  openWorkspaceFileWithDefaultApp,
  revealWorkspaceFileInFolder,
  workspaceFilePreviewMimeType,
} from './workspace-file-opening.js';

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

  it('copies and reveals only resolved files inside the workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-file-actions-'));
    await mkdir(path.join(workspaceRoot, 'src'));
    const targetPath = path.join(workspaceRoot, 'src', 'main.ts');
    await writeFile(targetPath, 'export {};\n');
    const copyText = vi.fn();
    const showItemInFolder = vi.fn();

    await expect(copyWorkspaceFilePath(workspaceRoot, 'src/main.ts', copyText)).resolves.toEqual({ ok: true });
    await expect(revealWorkspaceFileInFolder(workspaceRoot, 'src/main.ts', showItemInFolder)).resolves.toEqual({ ok: true });
    expect(copyText).toHaveBeenCalledWith(await realpath(targetPath));
    expect(showItemInFolder).toHaveBeenCalledWith(await realpath(targetPath));

    await expect(copyWorkspaceFilePath(workspaceRoot, '../outside.ts', copyText)).resolves.toMatchObject({ ok: false });
    expect(copyText).toHaveBeenCalledOnce();
  });

  it('creates previews only for PDF and image files inside the workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-preview-workspace-file-'));
    const pdfPath = path.join(workspaceRoot, 'report.pdf');
    const documentPath = path.join(workspaceRoot, 'notes.docx');
    await writeFile(pdfPath, '%PDF-test');
    await writeFile(documentPath, 'document');
    const registerPreview = vi.fn(() => 'http://127.0.0.1:1234/v1/file-previews/token/report.pdf');

    await expect(createWorkspaceFilePreviewUrl(workspaceRoot, 'report.pdf', registerPreview)).resolves.toEqual({
      ok: true,
      url: 'http://127.0.0.1:1234/v1/file-previews/token/report.pdf',
    });
    expect(registerPreview).toHaveBeenCalledWith({
      mimeType: 'application/pdf',
      name: 'report.pdf',
      targetPath: await realpath(pdfPath),
    });
    await expect(createWorkspaceFilePreviewUrl(workspaceRoot, 'notes.docx', registerPreview)).resolves.toEqual({
      ok: false,
      error: 'Only PDF and image files can be opened in the built-in browser.',
    });
    expect(workspaceFilePreviewMimeType(path.join('images', 'preview.WEBP'))).toBe('image/webp');
  });
});
