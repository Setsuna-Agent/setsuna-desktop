import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../store/file-config-store.js';
import { ManagedWorkspaceDependencyManager } from './managed-workspace-dependency-manager.js';

const execFileAsync = promisify(execFile);

describe('managed workspace dependency manager', () => {
  it.skipIf(process.platform === 'win32')('wraps the app Node runtime and reuses healthy host Python and uv tools', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-'));
    const fakeBin = path.join(dataDir, 'fake-bin');
    const previousPath = process.env.PATH;
    await mkdir(fakeBin, { recursive: true });
    await Promise.all([
      writeExecutable(path.join(fakeBin, 'python3'), '#!/bin/sh\necho "Python 3.12.9"\n'),
      writeExecutable(path.join(fakeBin, 'uv'), [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "uv 0.11.28"; else echo "fake uv $*"; fi',
        '',
      ].join('\n')),
    ]);
    process.env.PATH = [fakeBin, previousPath ?? ''].filter(Boolean).join(path.delimiter);

    try {
      const configStore = new FileConfigStore(dataDir);
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);
      const status = await manager.setEnabled({ enabled: true });

      expect(status).toMatchObject({
        enabled: true,
        state: 'ready',
        node: { available: true, source: 'bundled' },
        python: { available: true, source: 'system', version: 'Python 3.12.9' },
        uv: { available: true, source: 'system', version: 'uv 0.11.28' },
      });
      const shell = await manager.prepareShellEnvironment('python --version');
      const dependencyRoot = path.join(dataDir, 'workspace-dependencies');
      const installBin = path.join(dependencyRoot, 'toolchain', 'bin');
      expect(shell).toMatchObject({
        environment: {
          PIP_REQUIRE_VIRTUALENV: '1',
          UV_PYTHON: path.join(fakeBin, 'python3'),
        },
        writableRoots: [path.join(dependencyRoot, 'cache')],
      });
      expect(shell?.environment.PATH.split(path.delimiter).slice(0, 2)).toEqual([
        path.join(dependencyRoot, 'bin'),
        installBin,
      ]);
      await expect(execFileAsync(path.join(installBin, 'python'), ['--version'])).resolves.toMatchObject({
        stdout: expect.stringContaining('Python 3.12.9'),
      });
      await expect(execFileAsync(path.join(installBin, 'pip'), ['install', 'demo'])).resolves.toMatchObject({
        stdout: expect.stringContaining('fake uv pip install demo'),
      });
    } finally {
      process.env.PATH = previousPath;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('does not provision Python for an unrelated first shell command', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-workspace-dependencies-lazy-'));
    try {
      const configStore = new FileConfigStore(dataDir);
      const manager = new ManagedWorkspaceDependencyManager(dataDir, configStore);

      const shell = await manager.prepareShellEnvironment('git status --short');
      expect(shell?.environment.PATH.split(path.delimiter)[0]).toBe(
        path.join(dataDir, 'workspace-dependencies', 'bin'),
      );
      await expect(execFileAsync(path.join(dataDir, 'workspace-dependencies', 'bin', 'node'), ['--version']))
        .resolves.toMatchObject({ stdout: expect.stringMatching(/^v\d+/u) });
      await expect(manager.getStatus()).resolves.toMatchObject({
        enabled: true,
        state: 'not-installed',
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}
