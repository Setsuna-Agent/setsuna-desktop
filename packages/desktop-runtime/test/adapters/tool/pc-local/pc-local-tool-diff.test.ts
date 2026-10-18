import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_DIFF_PREVIEW_CHARS, FILE_DIFF_PREVIEW_LINES, projectFileChangePreview, projectFileDiff } from '@setsuna-desktop/contracts';
import { buildDeletedFileDiff, buildFileDiff, formatFileMutationReceipt, patchDiffFromDiffs, type PatchDiff } from '../../../../src/adapters/tool/pc-local/pc-local-tool-diff.js';
import { applyFileChangePatch } from '../../../../src/utils/file-change-patch.js';

describe('bounded file mutation diffs', () => {
  const root = path.resolve('workspace');
  it('treats a DLL as binary without expanding its bytes into text lines', () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 10);
    bytes.write('MZ');
    bytes[20] = 0;
    const diff = buildDeletedFileDiff({ root, filePath: path.join(root, 'library.dll'), previousContent: bytes, beforeMode: 0o644 });
    expect(diff).toMatchObject({ binary: true, action: 'Deleted', additions: 0, deletions: 0, lines: [] });
    expect(diff.undo).toBeUndefined();
    expect(JSON.stringify(diff).length).toBeLessThan(500);
  });

  it.each(['row\r\n'.repeat(150_000), 'x'.repeat(2_000_000)])('bounds large text previews while retaining exact deletion undo and redo', (text) => {
    const diff = buildDeletedFileDiff({ root, filePath: path.join(root, 'large.txt'), previousContent: Buffer.from(text), beforeMode: 0o640 });
    expect(diff.truncated).toBe(true);
    expect(diff.lines.length).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_LINES);
    expect(diff.lines.reduce((sum, line) => sum + line.content.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_CHARS);
    expect(diff.undo?.beforeMode).toBe(0o640);
    expect(applyFileChangePatch(null, diff.undo!, 'undo')).toBe(text);
    expect(applyFileChangePatch(text, diff.undo!, 'redo')).toBeNull();
    expect(projectFileDiff(diff)).not.toHaveProperty('undo');
    expect(diff.undo?.insert).toBe(text);
  });

  it('retains small edit line numbers and an exact patch independently of display limits', () => {
    const diff = buildFileDiff({ root, filePath: path.join(root, 'source.txt'), existed: true, previousContent: 'old\r\n', nextContent: 'new\r\n' });
    expect(diff).toMatchObject({ additions: 1, deletions: 1, truncated: false, lines: [
      { type: 'del', oldLine: 1, content: 'old' }, { type: 'add', newLine: 1, content: 'new' },
    ] });
    expect(applyFileChangePatch('new\r\n', diff.undo!, 'undo')).toBe('old\r\n');
  });

  it.each(['lines', 'characters'])('retains later files for on-demand review after the first file exhausts the %s budget', (budget) => {
    const large = buildFileDiff({ root, filePath: path.join(root, 'large.txt'), existed: false, previousContent: '',
      nextContent: budget === 'lines' ? 'created\n'.repeat(FILE_DIFF_PREVIEW_LINES) : 'x'.repeat(FILE_DIFF_PREVIEW_CHARS),
    });
    const small = buildFileDiff({ root, filePath: path.join(root, 'small.txt'), existed: true, previousContent: 'old\n', nextContent: 'new\n' });
    const patch = patchDiffFromDiffs([large, small]) as PatchDiff;
    expect(patch.diffs[1]).toEqual(small);
    expect(applyFileChangePatch('new\n', patch.diffs[1].undo!, 'undo')).toBe('old\n');
    const displayed = projectFileDiff(patch) as PatchDiff;
    expect(displayed.diffs[1]).toMatchObject({ path: 'small.txt', lines: [], truncated: true });
    const selected = projectFileChangePreview([{ id: 'message', role: 'assistant', content: '', createdAt: '',
      toolRuns: [{ id: 'patch', name: 'apply_patch', status: 'success', data: { diff: patch } }],
    }], { path: small.absolutePath!, toolCallIds: ['patch'] });
    expect(selected[0].run.data).toMatchObject({ diff: { diffs: [{ path: 'small.txt', truncated: false, lines: small.lines }] } });
    expect(JSON.stringify(selected)).not.toContain('undo');
    expect(patch.diffs[1]).toEqual(small);
  });

  it('does not count the unchanged body of a large file as deleted and re-added', () => {
    const prefix = 'unchanged\n'.repeat(100_000);
    const suffix = 'tail\n'.repeat(100_000);
    const diff = buildFileDiff({ root, filePath: path.join(root, 'large.txt'), existed: true,
      previousContent: `${prefix}old\n${suffix}`, nextContent: `${prefix}new\n${suffix}`,
    });
    expect(diff).toMatchObject({ additions: 1, deletions: 1, lines: [
      { type: 'del', oldLine: 100_001, content: 'old' },
      { type: 'add', newLine: 100_001, content: 'new' },
    ] });
  });

  it.each([
    { label: 'line budget', prefix: 'a\n'.repeat(6_000), offset: 6_000 },
    { label: 'character budget', prefix: `${'x'.repeat(300_000)}\r\n`, offset: 1 },
  ])('counts separated small edits exactly beyond the $label', ({ prefix, offset }) => {
    const middle = Array.from({ length: 100 }, (_, index) => `unchanged ${index}\n`).join('');
    const suffix = 'unchanged tail\n'.repeat(100);
    const previousContent = `${prefix}old first\n${middle}old last\n${suffix}`;
    const nextContent = `${prefix}new first\n${middle}new last\n${suffix}`;
    const diff = buildFileDiff({ root, filePath: path.join(root, 'large.txt'), existed: true, previousContent, nextContent });
    expect(diff).toMatchObject({ additions: 2, deletions: 2, truncated: false });
    expect(diff.lines.filter((line) => line.type === 'add' || line.type === 'del')).toEqual([
      { type: 'del', oldLine: offset + 1, lineNumber: offset + 1, content: 'old first' },
      { type: 'add', newLine: offset + 1, lineNumber: offset + 1, content: 'new first' },
      { type: 'del', oldLine: offset + 102, lineNumber: offset + 102, content: 'old last' },
      { type: 'add', newLine: offset + 102, lineNumber: offset + 102, content: 'new last' },
    ]);
    expect(formatFileMutationReceipt([diff])).toContain('(+2/-2)');
    expect(applyFileChangePatch(nextContent, diff.undo!, 'undo')).toBe(previousContent);
    expect(applyFileChangePatch(previousContent, diff.undo!, 'redo')).toBe(nextContent);
  });
});
