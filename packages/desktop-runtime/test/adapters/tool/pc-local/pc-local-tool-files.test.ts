import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listDirectory,
  applyLocalPatch,
  appendLocalFile,
  editLocalFile,
  readLocalFile,
  rememberRead,
  type PcLocalFileState,
  writeLocalFile,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-files.js';
import { MAX_TEXT_BYTES } from '../../../../src/adapters/tool/pc-local/pc-local-tool-constants.js';
import { openValidatedReadableFile } from '../../../../src/adapters/tool/pc-local/pc-local-tool-secure-read.js';
import {
  windowsProcessTreeKillArgs,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-process.js';

describe('PC local tool resource bounds', () => {
  it('requires a later sampling step after reading previously unobserved or changed contents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-read-sampling-'));
    const state: PcLocalFileState = { root, reads: new Map() };
    const filePath = path.join(root, 'source.txt');
    const input = { file_path: 'source.txt', content: 'replacement\n' };
    try {
      await writeFile(filePath, 'original\n');
      await readLocalFile({ file_path: input.file_path }, state);
      state.samplingStepId = 'step_1';
      // A partial model read cannot promote an unscoped full read into model evidence.
      await readLocalFile({ file_path: input.file_path, offset: 1, limit: 1 }, state);
      state.samplingStepId = 'step_2';
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false });
      await readLocalFile({ file_path: input.file_path }, state);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false, content: expect.stringContaining('同一采样批次') });
      expect(await readFile(filePath, 'utf8')).toBe('original\n');

      state.samplingStepId = 'step_3';
      await writeFile(filePath, 'external\n');
      await readLocalFile({ file_path: input.file_path }, state);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false, content: expect.stringContaining('同一采样批次') });
      expect(await readFile(filePath, 'utf8')).toBe('external\n');
      state.samplingStepId = 'step_4';
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: true });
      expect(await readFile(filePath, 'utf8')).toBe(input.content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds mutation excerpts while retaining the affected paths and change counts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-mutation-receipt-'));
    try {
      const result = await applyLocalPatch({ patch: [
        '*** Begin Patch', '*** Add File: large.txt',
        ...Array.from({ length: 100 }, (_, index) => `+line ${index}: ${'x'.repeat(150)}`),
        '*** Add File: small.txt', '+small', '*** End Patch',
      ].join('\n') }, { root, reads: new Map() });
      expect(result).toMatchObject({ ok: true });
      expect(result.content).toContain('Created "large.txt" (+100/-0); new lines 1-100');
      expect(result.content).toContain('Created "small.txt" (+1/-0); new lines 1-1');
      expect(result.content).toContain('diff excerpt truncated');
      expect(result.content.length).toBeLessThan(7_000);
      expect(await readFile(path.join(root, 'large.txt'), 'utf8')).toContain('line 99:');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires complete observed contents before an overwrite and detects same-size external changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-observed-write-'));
    const filePath = path.join(root, 'source.ts');
    const state = { root, reads: new Map() };
    const input = { file_path: 'source.ts', content: 'rewritten\n' };
    try {
      await writeFile(filePath, 'before\n');
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false });
      await readLocalFile({ file_path: input.file_path, offset: 1, limit: 1 }, state);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false });

      await writeFile(filePath, 'x'.repeat(MAX_TEXT_BYTES + 100));
      const truncated = await readLocalFile({ file_path: input.file_path }, state);
      expect(truncated.content).toContain('truncated');
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false });

      // Locally complete CJK output still exceeds the model's UTF-8 token budget.
      await writeFile(filePath, '字'.repeat(20_000));
      await readLocalFile({ file_path: input.file_path }, state);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false });

      await writeFile(filePath, 'before\n');
      await readLocalFile({ file_path: input.file_path }, state);
      const info = await stat(filePath);
      await writeFile(filePath, 'edited\n');
      await utimes(filePath, info.atime, info.mtime);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: false, content: expect.stringContaining('发生了变化') });
      expect(await readFile(filePath, 'utf8')).toBe('edited\n');

      await readLocalFile({ file_path: input.file_path }, state);
      expect(await writeLocalFile(input, state)).toMatchObject({ ok: true });
      expect(await readFile(filePath, 'utf8')).toBe(input.content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['apply_patch', 'edit', 'append_file', 'write_file'])('%s does not masquerade as a fresh source read', async (tool) => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-write-observation-'));
    const state = { root, reads: new Map() };
    const filePath = path.join(root, 'source.ts');
    try {
      await writeFile(filePath, 'before\n');
      await readLocalFile({ file_path: 'source.ts' }, state);
      const result = tool === 'apply_patch'
        ? await applyLocalPatch({ patch: '*** Begin Patch\n*** Update File: source.ts\n@@\n-before\n+after\n*** End Patch' }, state)
        : tool === 'edit'
          ? await editLocalFile({ file_path: 'source.ts', old_string: 'before', new_string: 'after' }, state)
          : tool === 'append_file'
            ? await appendLocalFile({ file_path: 'source.ts', content: 'after\n' }, state)
            : await writeLocalFile({ file_path: 'source.ts', content: 'after\n' }, state);
      expect(result).toMatchObject({ ok: true });
      const after = await readFile(filePath, 'utf8');
      expect(await writeLocalFile({ file_path: 'source.ts', content: 'blind rewrite\n' }, state)).toMatchObject({ ok: false });
      expect(await readFile(filePath, 'utf8')).toBe(after);
      // Exact edits still operate on current text without a compulsory full reread.
      expect(await editLocalFile({ file_path: 'source.ts', old_string: 'after', new_string: 'final' }, state)).toMatchObject({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['\n', '\r\n'])('preserves source lines in bounded reads with %j line endings', async (newline) => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-read-lines-'));
    try {
      const lines = ['before', '', '', '  ', 'const value = 1;', '', 'after'];
      await writeFile(path.join(root, 'source.ts'), lines.join(newline), 'utf8');

      const result = await readLocalFile(
        { file_path: 'source.ts', offset: 2, limit: 5 },
        { root, reads: new Map() },
      );

      expect(result).toMatchObject({ ok: true });
      expect(result.content).toBe([
        'File: source.ts (lines 2-6; file continues)',
        '2: ',
        '3: ',
        '4:   ',
        '5: const value = 1;',
        '6: ',
      ].join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports generated and dependency directories and permits listing their contents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-list-directory-'));
    try {
      await Promise.all([
        mkdir(path.join(root, 'dist')),
        mkdir(path.join(root, 'node_modules', 'example-package'), { recursive: true }),
      ]);
      const result = await listDirectory(
        { path: '.' },
        { root, reads: new Map() },
      );

      expect(result).toMatchObject({ ok: true });
      expect(result.content).toContain('[DIR] dist');
      expect(result.content).toContain('[DIR] node_modules');

      const packageListing = await listDirectory(
        { path: 'node_modules' },
        { root, reads: new Map() },
      );
      expect(packageListing.content).toContain('[DIR] example-package');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds per-turn file read identities', () => {
    const state = { reads: new Map() };
    const info = { mtimeMs: 1, size: 1 };
    for (let index = 0; index < 2_100; index += 1) {
      const filePath = `/workspace/file-${index}.txt`;
      rememberRead(state, filePath, info);
    }

    expect(state.reads.size).toBe(2_048);
    expect(state.reads.has('/workspace/file-0.txt')).toBe(false);
    expect(state.reads.has('/workspace/file-2099.txt')).toBe(true);
  });

  it('uses Windows taskkill process-tree arguments for graceful and forced termination', () => {
    expect(windowsProcessTreeKillArgs(42, 'SIGTERM')).toEqual(['/pid', '42', '/t', '/f']);
    expect(windowsProcessTreeKillArgs(42, 'SIGKILL')).toEqual(['/pid', '42', '/t', '/f']);
  });

  it('reports a directory target as a write validation error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-write-directory-'));
    try {
      const result = await writeLocalFile(
        { file_path: '.', content: 'not written' },
        { root, reads: new Map() },
      );

      expect(result).toMatchObject({
        ok: false,
        content: 'Error: Path is not a writable file: .',
        display: 'Path is not a writable file: .',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
