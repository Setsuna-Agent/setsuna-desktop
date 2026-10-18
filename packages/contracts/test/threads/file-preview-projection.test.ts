import { describe, expect, it } from 'vitest';
import { projectEventFilePreviews, projectThreadFilePreviews } from '../../src/threads/file-preview-projection.js';
import { FILE_DIFF_PREVIEW_CHARS, FILE_DIFF_PREVIEW_LINES, projectFileDiff } from '../../src/workspace/file-diff-preview.js';
import type { RuntimeThread } from '../../src/threads.js';
import type { StoredThreadEvent } from '../../src/events.js';
import { projectFileChangePreview } from '../../src/workspace/file-change-preview.js';
import { fileDiffRecordsFromRun } from '../../src/workspace/file-change-data.js';

describe('historical file preview projections', () => {
  const diff = {
    type: 'file_diff', action: 'Deleted', path: 'legacy.txt', additions: 0, deletions: 16_475,
    truncated: false, lines: Array.from({ length: 16_475 }, (_, index) => ({ type: 'del', oldLine: index + 1, content: 'large legacy line'.repeat(16) })),
    undo: { insert: 'complete original content'.repeat(100_000) },
  };
  const data = { ok: true, diff };
  const preview = JSON.stringify({ diff });
  const thread: RuntimeThread = {
    id: 'legacy', title: 'Large history', createdAt: '', updatedAt: '', archived: false,
    messageCount: 1, lastMessagePreview: '', lastSeq: 10,
    messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: '', toolRuns: [{
      id: 'delete', name: 'delete_file', status: 'success', data, resultPreview: preview,
    }] }],
  };

  it('bounds existing snapshots without modifying raw records or their undo patch', () => {
    const stored = projectThreadFilePreviews(thread, 'storage');
    const displayed = projectThreadFilePreviews(stored);
    const run = displayed.messages[0].toolRuns![0];
    expect(stored.messages[0].toolRuns![0].data).toMatchObject({ diff: { undo: diff.undo } });
    expect(run.data).toMatchObject({ diff: { deletions: 16_475, truncated: true } });
    expect(run.data).not.toHaveProperty('diff.undo');
    expect(JSON.stringify(displayed).length).toBeLessThan(80_000);
    expect(projectThreadFilePreviews(stored, 'storage')).toBe(stored);
    expect(diff.lines).toHaveLength(16_475);
    expect(thread.messages[0].toolRuns![0].resultPreview).toBe(preview);
  });

  it('projects retained SSE events with identical bounds to snapshots and preserves their sequence', () => {
    const event: StoredThreadEvent = { id: 'completed', threadId: 'legacy', seq: 10, createdAt: '', type: 'tool.completed', payload: {
      toolCallId: 'delete', toolName: 'delete_file', status: 'success', content: 'Deleted legacy.txt', data, resultPreview: preview,
    } };
    const projected = projectEventFilePreviews(event);
    expect(projected).toMatchObject({ id: event.id, seq: 10, payload: { data: { diff: { truncated: true, deletions: 16_475 } } } });
    expect(JSON.stringify(projected).length).toBeLessThan(80_000);
    expect(event.payload.data).toBe(data);
  });

  it.each(['structured', 'preview-only'])('keeps a per-file preview through repeated storage projections for %s histories', (source) => {
    const second = { ...diff, path: 'second.txt', additions: 1, deletions: 1, action: 'Edited',
      lines: [{ type: 'del', oldLine: 1, content: 'before' }, { type: 'add', newLine: 1, content: 'after' }],
    };
    const patch = { type: 'patch_diff', diffs: [diff, second] };
    const raw: RuntimeThread = { ...thread, messages: [{ ...thread.messages[0], toolRuns: [{
      id: 'patch', name: 'apply_patch', status: 'success', resultPreview: JSON.stringify({ diff: patch }),
      ...(source === 'structured' ? { data: { diff: patch } } : {}),
    }] }] };
    const stored = projectThreadFilePreviews(raw, 'storage');
    const reopened = projectThreadFilePreviews(structuredClone(stored), 'storage');
    const displayed = projectThreadFilePreviews(reopened);
    expect(JSON.stringify(displayed).length).toBeLessThan(80_000);
    expect(JSON.stringify(displayed)).not.toContain('complete original content');
    expect(projectThreadFilePreviews(reopened, 'storage')).toBe(reopened);
    const files = fileDiffRecordsFromRun(reopened.messages[0].toolRuns![0]) as typeof diff[];
    for (const file of files) {
      expect(file.lines.length).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_LINES);
      expect(file.lines.reduce((sum, line) => sum + line.content.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_CHARS);
    }
    const preview = projectFileChangePreview(reopened.messages, { path: 'second.txt', toolCallIds: ['patch'] });
    expect(preview[0].run.data).toMatchObject({ diff: { diffs: [{ path: 'second.txt', truncated: false, lines: second.lines }] } });
    expect(JSON.stringify(preview)).not.toContain('undo');
    expect(raw.messages[0].toolRuns![0].resultPreview).toBe(JSON.stringify({ diff: patch }));
  });

  it('bounds individual giant lines and each member of a patch without losing file identity', () => {
    const projected = projectFileDiff({ type: 'patch_diff', diffs: [{ ...diff, path: 'one.txt' }, { ...diff, path: 'two.txt', lines: [{ type: 'add', content: 'x'.repeat(1_000_000) }] }] }) as { diffs: typeof diff[] };
    expect(projected.diffs.map((file) => file.path)).toEqual(['one.txt', 'two.txt']);
    expect(projected.diffs.flatMap((file) => file.lines).reduce((sum, line) => sum + line.content.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_CHARS);
    for (const file of projected.diffs) {
      expect(file.lines.length).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_LINES);
      expect(file.lines.reduce((sum, line) => sum + line.content.length, 0)).toBeLessThanOrEqual(FILE_DIFF_PREVIEW_CHARS);
    }
  });
});
