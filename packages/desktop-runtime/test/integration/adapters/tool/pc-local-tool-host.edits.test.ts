import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHost } from './pc-local-tool-host.support.js';

describe('batch edit tool lifecycle', () => {
  it.each(['batch', 'legacy'])('round-trips the BOM returned by read_file through %s edits', async (shape) => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.ts');
    const original = '\uFEFFfirst\r\nfirst\r\n';
    await writeFile(filePath, original);
    const read = await host.runTool('read_file', { file_path: 'source.ts' }, context);
    const oldString = read.content.split('\n')[1].replace(/\r$/, '');
    expect(oldString).toBe('\uFEFFfirst');
    const edit = { old_string: oldString, new_string: oldString.replace('first', 'updated') };
    const args = { file_path: 'source.ts', ...(shape === 'batch' ? { edits: [edit] } : edit) };
    const preview = await host.previewToolCall('edit', args, context);
    expect(preview?.integrityToken).toBeTruthy();
    const result = await host.runTool('edit', args, { ...context, expectedPreviewIntegrityToken: preview?.integrityToken });
    expect(JSON.parse(result.preview ?? '{}').diff).toEqual(JSON.parse(preview?.resultPreview ?? '{}').diff);
    expect(await readFile(filePath, 'utf8')).toBe('\uFEFFupdated\r\nfirst\r\n');
  });

  it('uses the same validated batch for preview, write and undo while invalidating the prior read', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.ts');
    const original = '\uFEFFasync function processCovers(\r\n  input: string,\r\n) {}\r\nconst version = 1;\r\n';
    const args = { file_path: 'source.ts', edits: [
      { old_string: 'const version = 1;', new_string: 'const version = 2;' },
      { old_string: 'async function processCovers(\n  input: string,', new_string: 'export async function processCovers(\n  input: string,' },
    ] };
    await writeFile(filePath, original);
    await host.runTool('read_file', { file_path: args.file_path }, context);

    const preview = await host.previewToolCall('edit', args, context);
    expect(preview?.integrityToken).toBeTruthy();
    expect(await readFile(filePath, 'utf8')).toBe(original);
    const result = await host.runTool('edit', args, { ...context, expectedPreviewIntegrityToken: preview?.integrityToken });
    const diff = JSON.parse(result.preview ?? '{}').diff;
    expect(diff).toEqual(JSON.parse(preview?.resultPreview ?? '{}').diff);
    expect(result.content).toContain('export async function processCovers(');
    const updated = await readFile(filePath, 'utf8');
    expect(updated).toBe(original.replace('async function', 'export async function').replace('version = 1', 'version = 2'));
    const undo = diff.undo;
    expect(updated.slice(0, undo.start) + undo.insert + updated.slice(undo.start + undo.deleteCount)).toBe(original);
    await expect(host.runTool('write_file', { file_path: args.file_path, content: 'replacement' }, context))
      .rejects.toThrow('完整读取');
  });

  it.each([
    [{ old_string: 'first', new_string: 'FIRST' }, { old_string: 'missing', new_string: 'changed' }],
    [{ old_string: 'first\nsecond', new_string: 'FIRST' }, { old_string: 'second', new_string: 'SECOND' }],
    [{ old_string: 'first', new_string: 'FIRST' }, { old_string: 'second' }],
  ])('leaves the file untouched when any batch entry is invalid: %j', async (...edits) => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.ts');
    const original = 'first\nsecond\n';
    await writeFile(filePath, original);
    const args = { file_path: 'source.ts', edits };
    const preview = await host.previewToolCall('edit', args, context);
    expect(preview?.resultPreview).toBeUndefined();
    await expect(host.runTool('edit', args, context)).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(original);
  });

  it('refuses a stale approved batch even when the edited blocks still match', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const filePath = path.join(projectDir, 'source.ts');
    const args = { file_path: 'source.ts', edits: [{ old_string: 'first', new_string: 'FIRST' }] };
    await writeFile(filePath, 'first\nsecond\n');
    const preview = await host.previewToolCall('edit', args, context);
    const changed = 'first\nexternal change\n';
    await writeFile(filePath, changed);
    await expect(host.runTool('edit', args, { ...context, expectedPreviewIntegrityToken: preview?.integrityToken }))
      .rejects.toThrow('Files changed after the approved preview');
    expect(await readFile(filePath, 'utf8')).toBe(changed);
  });

  it('waits for complete arguments before exposing a replacement preview', async () => {
    const { host, projectDir } = await createHost();
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    await writeFile(path.join(projectDir, 'source.ts'), 'original\n');
    const raw = '{"file_path":"source.ts","edits":[{"old_string":"original","new_string":"new';
    const partial = await host.previewPartialToolCall('edit', raw, context);
    expect(partial?.argumentsPreview).toContain('source.ts');
    expect(partial?.resultPreview).toBeUndefined();
    const completeArgs = { ...JSON.parse(raw + '"}]}'), preview: { path: 'forged.ts', additions: 100 } };
    const complete = await host.previewPartialToolCall('edit', JSON.stringify(completeArgs), context);
    expect(JSON.parse(complete?.resultPreview ?? '{}').diff).toMatchObject({ additions: 1, deletions: 1 });
    expect(await readFile(path.join(projectDir, 'source.ts'), 'utf8')).toBe('original\n');
  });
});
