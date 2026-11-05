import { describe, expect, it } from 'vitest';
import { fileChangeSummaryFromRuns } from '../../../../../src/features/chat/tool-runs/runtimeFileChanges.js';

describe('RuntimeToolRuns final file changes', () => {

  it('keeps normalized final file changes available for review panels', () => {
    const summary = fileChangeSummaryFromRuns([
      {
        id: 'call_edit',
        name: 'edit_file',
        status: 'success',
        resultPreview: JSON.stringify({
          diff: {
            path: 'src/domain/agent/drawer/ChatLogDrawer.vue',
            action: 'Edited',
            additions: 1,
            deletions: 1,
            truncated: false,
            lines: [
              { type: 'del', lineNumber: 66, oldLine: 66, content: 'const now = new Date()' },
              { type: 'add', lineNumber: 66, newLine: 66, content: 'const today = new Date()' },
              { type: 'gap', content: '6 unmodified lines' },
            ],
          },
        }),
      },
    ]);

    expect(summary).not.toBeNull();

    expect(summary?.files[0]?.lines).toEqual([
      { type: 'removed', lineNumber: 66, oldLine: 66, newLine: undefined, content: 'const now = new Date()' },
      { type: 'added', lineNumber: 66, oldLine: undefined, newLine: 66, content: 'const today = new Date()' },
      { type: 'gap', lineNumber: undefined, oldLine: undefined, newLine: undefined, content: '6 unmodified lines' },
    ]);
  });

  it('infers omitted file change gap rows from skipped diff line numbers', () => {
    const summary = fileChangeSummaryFromRuns([
      {
        id: 'call_edit',
        name: 'edit_file',
        status: 'success',
        resultPreview: JSON.stringify({
          diff: {
            path: 'src/theme.css',
            action: 'Edited',
            additions: 1,
            deletions: 0,
            truncated: false,
            lines: [
              { type: 'context', oldLine: 1, newLine: 1, content: '.root {' },
              { type: 'add', lineNumber: 9, newLine: 9, content: '  color: red;' },
            ],
          },
        }),
      },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.files[0]?.lines).toContainEqual({
      type: 'gap',
      content: '7 unmodified lines',
    });
  });

  it('folds dense unchanged context between changed file diff blocks', () => {
    const summary = fileChangeSummaryFromRuns([
      {
        id: 'call_edit',
        name: 'edit_file',
        status: 'success',
        resultPreview: JSON.stringify({
          diff: {
            path: 'Book/2048/style/main.css',
            action: 'Edited',
            additions: 2,
            deletions: 1,
            truncated: false,
            lines: [
              { type: 'del', oldLine: 2, content: '  color: old;' },
              { type: 'add', newLine: 2, content: '  color: new;' },
              ...Array.from({ length: 15 }, (_, index) => ({
                type: 'context',
                oldLine: index + 3,
                newLine: index + 3,
                content: `line ${index + 3}`,
              })),
              { type: 'add', newLine: 18, content: 'body {' },
            ],
          },
        }),
      },
    ]);

    expect(summary).not.toBeNull();
    const lines = summary?.files[0]?.lines.map((line) => line.content);

    expect(lines).toContain('9 unmodified lines');
    expect(lines).toContain('line 3');
    expect(lines).toContain('line 5');
    expect(lines).not.toContain('line 6');
    expect(lines).toContain('line 15');
    expect(lines).toContain('line 17');
  });
});
