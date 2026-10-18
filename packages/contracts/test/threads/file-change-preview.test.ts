import { expect, it } from 'vitest';
import type { RuntimeMessage, RuntimeToolRun } from '../../src/threads.js';
import { projectFileChangePreview } from '../../src/workspace/file-change-preview.js';
import { FILE_DIFF_PREVIEW_CHARS, FILE_DIFF_PREVIEW_LINES } from '../../src/workspace/file-diff-preview.js';

it.each([10, 1000])('shares one preview budget across all operations without copying other output (line width %s)', (width) => {
  const source = Array.from({ length: 3 }, (_, index) => message({ id: `edit_${index}`, name: 'edit', status: 'success',
    argumentsPreview: 'private arguments', resultPreview: 'private preview', data: { diff: {
      type: 'file_diff', path: 'a.ts', absolutePath: '/repo/a.ts', additions: 200, deletions: 0,
      undo: { text: 'private undo' }, lines: Array.from({ length: 200 }, (_, i) => ({ type: 'add', newLine: i + 1, content: 'x'.repeat(width) })),
    } },
  }));
  const result = projectFileChangePreview(source, { path: '/repo/a.ts', toolCallIds: ['edit_0', 'edit_1', 'edit_2', 'edit_0'] });
  expect(result.map(({ run }) => run.id)).toEqual(['edit_0', 'edit_1', 'edit_2']);
  const files = result.flatMap(({ run }) => (run.data as { diff: { diffs: { lines: { content: string }[]; truncated: boolean; additions: number }[] } }).diff.diffs);
  expect(files.reduce((sum, file) => sum + file.lines.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_LINES);
  expect(files.flatMap((file) => file.lines).reduce((sum, line) => sum + line.content.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_CHARS);
  expect(files.reduce((sum, file) => sum + file.additions, 0)).toBe(600);
  expect(files.at(-1)?.truncated).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(source[0].toolRuns![0].data).toHaveProperty('diff.undo.text', 'private undo');
});

it('reads only the requested successful file operation, including legacy preview-only patches', () => {
  const run: RuntimeToolRun = { id: 'patch', name: 'apply_patch', status: 'success', resultPreview: JSON.stringify({ diff: {
    diffs: [{ path: 'a.ts', additions: 1, lines: [{ type: 'add', newLine: 1, content: 'requested' }] },
      { path: 'other.ts', lines: [{ type: 'add', content: 'unrelated' }] }],
  } }) };
  const messages = [message({ ...run, id: 'foreign' }), message({ ...run, id: 'failed', status: 'error' }),
    { ...message({ ...run, id: 'hidden' }), visibility: 'model' as const }, message(run)];
  const result = projectFileChangePreview(messages, { path: 'a.ts', toolCallIds: ['patch', 'failed', 'hidden', 'missing'] });
  expect(result.map(({ run: item }) => item.id)).toEqual(['patch']);
  expect(JSON.stringify(result)).toContain('requested');
  expect(JSON.stringify(result)).not.toContain('unrelated');
  expect(projectFileChangePreview(messages, { path: 'unrecorded.ts', toolCallIds: ['patch'] })).toEqual([]);
});

function message(run: RuntimeToolRun): RuntimeMessage {
  return { id: run.id, role: 'assistant', content: '', createdAt: '', toolRuns: [run] };
}
