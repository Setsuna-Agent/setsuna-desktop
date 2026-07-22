import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rememberRead, rememberReadFileResult } from './pc-local-tool-files.js';
import { openValidatedReadableFile } from './pc-local-tool-secure-read.js';
import { appendBoundedProcessText, collectProcess, windowsProcessTreeKillArgs } from './pc-local-tool-shell-process.js';

describe('PC local tool resource bounds', () => {
  it('bounds per-turn file read identity and range caches', () => {
    const state = { reads: new Map(), readFileResults: new Map() };
    const info = { mtimeMs: 1, size: 1 };
    for (let index = 0; index < 2_100; index += 1) {
      const filePath = `/workspace/file-${index}.txt`;
      rememberRead(state, filePath, info);
      rememberReadFileResult(state, filePath, info, { offset: index + 1, limit: 1 }, 'runtime');
    }

    expect(state.reads.size).toBe(2_048);
    expect(state.readFileResults.size).toBe(2_048);
    expect(state.reads.has('/workspace/file-0.txt')).toBe(false);
    expect(state.reads.has('/workspace/file-2099.txt')).toBe(true);
  });

  it('uses Windows taskkill process-tree arguments for graceful and forced termination', () => {
    expect(windowsProcessTreeKillArgs(42, 'SIGTERM')).toEqual(['/pid', '42', '/t']);
    expect(windowsProcessTreeKillArgs(42, 'SIGKILL')).toEqual(['/pid', '42', '/t', '/f']);
  });

  it('bounds collected Git stdout before result formatting', () => {
    const first = appendBoundedProcessText('', 0, 'a'.repeat(200_000));
    const second = appendBoundedProcessText(first.text, first.omittedChars, 'b'.repeat(200_000));

    expect(second.text).toHaveLength(240_000);
    expect(second.omittedChars).toBe(160_000);
  });

  it('does not spawn a Git process when collection is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort('cancelled before spawn');
    let spawnCalls = 0;

    const result = await collectProcess(
      'git',
      ['status'],
      process.cwd(),
      1_000,
      controller.signal,
      () => {
        spawnCalls += 1;
        throw new Error('spawn must not be called');
      },
    );

    expect(spawnCalls).toBe(0);
    expect(result).toMatchObject({ aborted: true, exitCode: null });
  });

  it.skipIf(process.platform === 'win32')('keeps reads bound to the validated descriptor after a directory is replaced', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-secure-read-'));
    const safeDirectory = path.join(root, 'safe');
    const movedDirectory = path.join(root, 'safe-original');
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'setsuna-secure-read-outside-'));
    await mkdir(safeDirectory);
    await writeFile(path.join(safeDirectory, 'value.txt'), 'approved content\n', 'utf8');
    await writeFile(path.join(outsideDirectory, 'value.txt'), 'outside secret\n', 'utf8');
    const opened = await openValidatedReadableFile(path.join(safeDirectory, 'value.txt'), {
      root,
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
    });

    try {
      await rename(safeDirectory, movedDirectory);
      await symlink(outsideDirectory, safeDirectory);
      await expect(opened.handle.readFile({ encoding: 'utf8' })).resolves.toBe('approved content\n');
    } finally {
      await opened.handle.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

});
