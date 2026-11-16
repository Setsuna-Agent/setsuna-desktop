import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { openWorkspaceApp } from '../../src/main/apps.js';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>(), existsSync: () => true }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => Object.assign(new EventEmitter(), { unref: () => undefined })),
}));
afterEach(() => vi.clearAllMocks());

it('opens the exact HTML file as a URL without treating line numbers or filename characters as browser arguments', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-browser-open-'));
  try {
    const filename = "page #1's.html";
    await writeFile(path.join(root, filename), '<html></html>');
    const fileUrl = pathToFileURL(await realpath(path.join(root, filename))).href;
    await openWorkspaceApp({ workspaceRoot: root, appId: 'microsoft-edge', filePath: filename, line: 18 });
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toEqual(process.platform === 'darwin'
      ? ['-a', 'Microsoft Edge', fileUrl]
      : [fileUrl]);
    await writeFile(path.join(root, 'source.ts'), 'export {}');
    await expect(openWorkspaceApp({ workspaceRoot: root, appId: 'microsoft-edge', filePath: 'source.ts' })).rejects.toThrow();
    await expect(openWorkspaceApp({ workspaceRoot: root, appId: 'microsoft-edge' })).rejects.toThrow();
    expect(spawn).toHaveBeenCalledOnce();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
