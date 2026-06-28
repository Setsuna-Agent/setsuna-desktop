import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { collapseFileMutationRunsInSegments, fileChangeSummaryFromRuns, latestFileChangeSummaryFromMessages } from './runtimeFileChanges.js';

describe('runtime file changes', () => {
  it('collapses repeated writes for the same path without losing change totals', () => {
    const segments: RuntimeMessage[] = [
      {
        id: 'msg_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_1',
            name: 'workspace_write_file',
            status: 'success',
            argumentsPreview: JSON.stringify({ path: 'merge_sort.py' }),
            resultPreview: JSON.stringify({
              diff: {
                path: 'merge_sort.py',
                action: 'Created',
                additions: 12,
                deletions: 0,
                truncated: false,
                lines: [{ type: 'added', lineNumber: 1, newLine: 1, content: 'def merge_sort(arr):' }],
              },
            }),
          },
        ],
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: '继续处理',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_2',
            name: 'workspace_write_file',
            status: 'success',
            argumentsPreview: JSON.stringify({ path: 'merge_sort.py' }),
            resultPreview: JSON.stringify({
              diff: {
                path: 'merge_sort.py',
                action: 'Modified',
                additions: 1,
                deletions: 1,
                truncated: false,
                lines: [{ type: 'added', lineNumber: 1, newLine: 12, content: 'print(merge_sort([3, 1, 2]))' }],
              },
            }),
          },
        ],
      },
    ];

    const collapsed = collapseFileMutationRunsInSegments(segments);
    const visibleRuns = collapsed.flatMap((segment) => segment.toolRuns ?? []);
    const summary = fileChangeSummaryFromRuns(visibleRuns);

    expect(visibleRuns.map((run) => run.id)).toEqual(['call_2']);
    expect(summary).toMatchObject({
      files: [
        {
          path: 'merge_sort.py',
          action: 'Created',
          additions: 13,
          deletions: 1,
        },
      ],
      additions: 13,
      deletions: 1,
    });
  });

  it('finds the latest assistant file change group for review panels', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'first',
        createdAt: '2026-06-26T00:00:00.000Z',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_old',
            name: 'workspace_write_file',
            status: 'success',
            resultPreview: JSON.stringify({
              diff: { path: 'old.txt', action: 'Created', additions: 1, deletions: 0, truncated: false, lines: [] },
            }),
          },
        ],
      },
      {
        id: 'user_2',
        role: 'user',
        content: 'second',
        createdAt: '2026-06-26T00:00:02.000Z',
      },
      {
        id: 'assistant_2',
        role: 'assistant',
        content: 'done',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_new',
            name: 'workspace_write_file',
            status: 'success',
            resultPreview: JSON.stringify({
              diff: { path: 'merge_sort.py', action: 'Created', additions: 35, deletions: 0, truncated: false, lines: [] },
            }),
          },
        ],
      },
    ];

    expect(latestFileChangeSummaryFromMessages(messages)).toMatchObject({
      files: [{ path: 'merge_sort.py', additions: 35, deletions: 0 }],
      additions: 35,
      deletions: 0,
    });
  });

  it('does not merge adjacent assistant file change groups from different turns', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'assistant_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_old',
            name: 'workspace_write_file',
            status: 'success',
            resultPreview: JSON.stringify({
              diff: { path: 'merge_sort.py', action: 'Created', additions: 12, deletions: 0, truncated: false, lines: [] },
            }),
          },
        ],
      },
      {
        id: 'assistant_2',
        role: 'assistant',
        turnId: 'turn_2',
        content: '',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
        toolRuns: [
          {
            id: 'call_new',
            name: 'workspace_write_file',
            status: 'success',
            resultPreview: JSON.stringify({
              diff: { path: 'merge_sort.py', action: 'Modified', additions: 1, deletions: 1, truncated: false, lines: [] },
            }),
          },
        ],
      },
    ];

    expect(latestFileChangeSummaryFromMessages(messages)).toMatchObject({
      files: [{ path: 'merge_sort.py', action: 'Modified', additions: 1, deletions: 1 }],
      additions: 1,
      deletions: 1,
    });
  });
});
