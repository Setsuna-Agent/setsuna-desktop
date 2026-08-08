import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fileChangeSummaryFromRuns } from '../../../../../src/features/chat/tool-runs/runtimeFileChanges.js';
import { FileChangesSummaryCard } from '../../../../../src/features/chat/tool-runs/RuntimeToolRuns.js';
import { toolRun, renderedText, renderedTextFromHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns final file changes', () => {
  it('filters failed runs from the rendered process list', () => {
    expect(renderedText([
      toolRun('failed_file', 'write_file', { file_path: 'selection_sort.py' }, 'error'),
    ])).toBe('');

    const text = renderedText([
      toolRun('failed_file', 'write_file', { file_path: 'selection_sort.py' }, 'error'),
      toolRun('passed_shell', 'run_shell_command', { command: 'pnpm test' }),
    ]);

    expect(text).not.toContain('失败');
    expect(text).not.toContain('selection_sort.py');
    expect(text).toContain('已运行 pnpm test');
  });

  it('renders final file changes as review links', () => {
    const html = renderToStaticMarkup(createElement(FileChangesSummaryCard, {
      summary: {
        additions: 1,
        deletions: 0,
        files: [
          {
            path: 'book/2048/style/main.css',
            additions: 1,
            deletions: 0,
            truncated: false,
            lines: [
              {
                type: 'context',
                oldLine: 1,
                newLine: 1,
                content: '.tile { color: red; }',
              },
            ],
          },
        ],
      },
      onOpenReview: () => undefined,
    }));

    expect(html).toContain('<span class="chat-file-changes__title">已编辑 main.css</span><span class="chat-change-counts"');
    expect(html).not.toContain('chat-file-changes__file-icon');
    expect(html).toContain('<button class="chat-file-changes__row"');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('chat-file-changes__row-chevron');
    expect(html).not.toContain('chat-file-review__');
  });

  it('keeps multi-file change summaries scannable by previewing the first rows', () => {
    const html = renderToStaticMarkup(createElement(FileChangesSummaryCard, {
      summary: {
        additions: 15,
        deletions: 10,
        files: Array.from({ length: 5 }, (_, index) => ({
          path: `src/file-${index + 1}.ts`,
          additions: index + 1,
          deletions: index,
          truncated: false,
          lines: [],
        })),
      },
    }));
    const text = renderedTextFromHtml(html);

    expect(text).toContain('已编辑 5 个文件');
    // 多文件时标题后内联展示汇总增删统计（各文件 additions 1..5、deletions 0..4）
    expect(text).toContain('+15-10');
    expect(html).toContain('<span class="chat-file-changes__title">已编辑 5 个文件</span><span class="chat-change-counts"');
    expect(text).toContain('再显示 2 个文件');
    expect(html.match(/class="chat-file-changes__item"/gu)).toHaveLength(3);
    expect(text).toContain('src/file-3.ts');
    expect(text).not.toContain('src/file-4.ts');
  });

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
    const html = renderToStaticMarkup(createElement(FileChangesSummaryCard, { summary: summary! }));

    expect(summary?.files[0]?.lines).toEqual([
      { type: 'removed', lineNumber: 66, oldLine: 66, newLine: undefined, content: 'const now = new Date()' },
      { type: 'added', lineNumber: 66, oldLine: undefined, newLine: 66, content: 'const today = new Date()' },
      { type: 'gap', lineNumber: undefined, oldLine: undefined, newLine: undefined, content: '6 unmodified lines' },
    ]);
    expect(html).not.toContain('chat-file-review__');
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
