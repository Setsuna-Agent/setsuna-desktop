import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { FileChangesSummaryCard, RuntimeToolRuns, groupToolRuns, toolRunGroupDefaultOpen, toolRunPanelDefaultOpen } from './RuntimeToolRuns.js';
import { fileChangeSummaryFromRuns } from './runtimeFileChanges.js';

describe('RuntimeToolRuns default expansion', () => {
  it('keeps running and successful shell details collapsed by default', () => {
    expect(toolRunPanelDefaultOpen(shellRun('running'))).toBe(false);
    expect(toolRunPanelDefaultOpen(shellRun('success'))).toBe(false);
  });

  it('opens failed shell and generic tool details', () => {
    expect(toolRunPanelDefaultOpen(shellRun('error'))).toBe(true);
    expect(toolRunPanelDefaultOpen({ id: 'call_generic', name: 'some_tool', status: 'error' })).toBe(true);
  });

  it('keeps active groups collapsed while preserving failed and approval details', () => {
    expect(toolRunGroupDefaultOpen('shell', 'running', false)).toBe(false);
    expect(toolRunGroupDefaultOpen('shell', 'success', false)).toBe(false);
    expect(toolRunGroupDefaultOpen('inspection', 'error', false)).toBe(true);
    expect(toolRunGroupDefaultOpen('generic', 'success', true)).toBe(true);
  });

  it('keeps adjacent operation categories as separate display groups', () => {
    const groups = groupToolRuns([
      toolRun('read_1', 'workspace_read_file', { path: 'a.ts' }),
      toolRun('read_2', 'workspace_read_file', { path: 'b.ts' }),
      toolRun('search_1', 'workspace_search_text', { query: 'needle' }),
      toolRun('shell_1', 'run_shell_command', { command: 'pnpm lint' }),
      toolRun('shell_2', 'run_shell_command', { command: 'pnpm test' }),
    ]);

    expect(groups.map(groupLabel)).toEqual([
      'inspection:2',
      'single:workspace_search_text',
      'shell:2',
    ]);
  });

  it('summarizes adjacent file mutation runs without raw JSON details', () => {
    const runs = [
      fileRun('write_selection', 'write_file', 'selection_sort.py', 'Created'),
      fileRun('edit_merge', 'edit_file', 'merge_sort.py', 'Modified'),
    ];
    const text = renderedText(runs);
    const html = renderedHtml(runs);

    expect(text).toContain('已创建 1 个文件，已编辑 1 个文件');
    expect(text).toContain('创建selection_sort.py');
    expect(text).toContain('编辑merge_sort.py');
    expect(html).toContain('<span class="chat-tool-run__title">已创建 1 个文件，已编辑 1 个文件</span>');
    expect(html).not.toContain('<span class="chat-tool-run__title">已创建 1 个文件，已编辑 1 个文件</span><span class="chat-change-counts"');
    expect(text).not.toContain('参数');
    expect(text).not.toContain('结果');
  });

  it('shows change counts next to a concrete single edited file instead of an aggregate count', () => {
    const html = renderedHtml([
      fileRun('edit_merge', 'edit_file', 'merge_sort.py', 'Modified'),
    ]);

    expect(html).toContain('<span class="chat-tool-run__file-status"><span>已编辑</span><code class="chat-tool-run__file-target" title="merge_sort.py">merge_sort.py</code></span>');
    expect(html).toContain('<span class="chat-change-counts"');
  });

  it('shows running file operation target and change counts in compact rows', () => {
    const single = renderedText([
      toolRun('write_running', 'write_file', { file_path: 'src/generated.ts', content: 'one\ntwo\n' }, 'running'),
    ]);

    expect(single).toContain('正在写入');
    expect(single).toContain('generated.ts');
    expect(single).toContain('+2-0');

    const grouped = renderedText([
      {
        ...toolRun('write_running', 'write_file', { file_path: 'src/generated.ts', content: 'one\ntwo\n' }, 'running'),
        resultPreview: JSON.stringify({
          diff: {
            path: 'src/generated.ts',
            action: 'Created',
            additions: 2,
            deletions: 0,
            truncated: false,
            lines: [],
          },
        }),
      },
    ], 'latest');

    expect(grouped).toContain('正在写入');
    expect(grouped).toContain('generated.ts');
    expect(grouped).toContain('+2-0');
    expect(grouped).not.toContain('运行中');
  });

  it('coalesces repeated mixed aggregate categories into one compact summary', () => {
    const text = renderedText([
      toolRun('read_1', 'read_file', { file_path: 'a.ts' }),
      fileRun('write_a', 'write_file', 'a.ts', 'Created'),
      toolRun('read_2', 'read_file', { file_path: 'b.ts' }),
      fileRun('edit_b', 'edit_file', 'b.ts', 'Modified'),
      toolRun('read_3', 'read_file', { file_path: 'c.ts' }),
    ]);

    expect(text).toContain('已读取 3 个文件，已创建 1 个文件，已编辑 1 个文件');
    expect(text).not.toContain('已读取 1 个文件，已创建 1 个文件，已读取 1 个文件');
  });

  it('shows the command in the summary for a single shell run', () => {
    const text = renderedText([
      toolRun('shell_single', 'run_shell_command', { command: 'pnpm exec vitest run apps/desktop/renderer/src/components/chat/runtimeFileChanges.test.ts' }),
    ]);

    expect(text).toContain('已运行 pnpm exec vitest run apps/desktop/renderer/src/components/chat/runtimeFileChanges.test.ts');
    expect(text).not.toContain('已运行 1 条命令');
  });

  it('wraps adjacent file and shell groups into one mixed summary', () => {
    const runs = [
      fileRun('write_selection', 'write_file', 'selection_sort.py', 'Created'),
      toolRun('shell_single', 'run_shell_command', { command: 'python3 selection_sort.py' }),
    ];
    const text = renderedText(runs);
    const html = renderedHtml(runs);

    expect(html).toContain('chat-tool-run--mixed');
    expect(text).toContain('已创建 1 个文件，已运行 1 条命令');
    expect(text.match(/已创建 1 个文件/gu)).toHaveLength(1);
    expect(text).toContain('创建selection_sort.py');
    expect(text).toContain('+12-0');
    expect(text).toContain('已运行 python3 selection_sort.py');
  });

  it('can show the latest mixed operation as the outer summary', () => {
    const text = renderedText([
      toolRun('find_file', 'find_files', { query: 'quick_sort.py' }),
      toolRun('read_file', 'workspace_read_file', { path: 'quick_sort.py' }),
      fileRun('write_selection', 'write_file', 'selection_sort.py', 'Created'),
      toolRun('shell_single', 'run_shell_command', { command: 'python3 selection_sort.py' }),
    ], 'latest');

    expect(text).toContain('已运行 python3 selection_sort.py');
    expect(text).not.toContain('已查找 1 次文件，已读取 1 个文件，已创建 1 个文件');
  });

  it('does not label file lookups as inspected directories', () => {
    const text = renderedText([
      toolRun('find_file', 'find_files', { query: 'quick_sort.py' }),
      toolRun('read_file', 'workspace_read_file', { path: 'quick_sort.py' }),
    ]);

    expect(text).toContain('已查找 1 次文件，已读取 1 个文件');
    expect(text).toContain('已查找文件quick_sort.py');
    expect(text).toContain('已读取文件quick_sort.py');
    expect(text).not.toContain('已查看目录quick_sort.py');
  });

  it('summarizes web-content MCP runs without exposing raw arguments or fetched page text', () => {
    const html = renderedHtml([
      {
        ...toolRun('fetch_web', 'mcp search-mcp fetchWebContent', {
          url: 'https://tophub.today/c/brief/',
          maxChars: 15000,
        }),
        resultPreview: 'Daily\\n热门\\n今日更新的所有简报聚合内容',
      },
    ]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('已获取网页');
    expect(text).toContain('tophub.today/c/brief');
    expect(text).not.toContain('参数');
    expect(text).not.toContain('结果');
    expect(text).not.toContain('maxChars');
    expect(text).not.toContain('Daily');
    expect(html).not.toContain('chat-tool-run__preview');
  });

  it('uses a compact summary for grouped web-content MCP runs', () => {
    const text = renderedText([
      toolRun('fetch_brief', 'mcp search-mcp fetchWebContent', { url: 'https://tophub.today/c/brief/' }),
      toolRun('fetch_news', 'mcp search-mcp fetchWebContent', { url: 'https://news.qq.com/' }),
    ]);

    expect(text).toContain('已获取 2 个网页');
    expect(text).not.toContain('fetchWebContent');
    expect(text).not.toContain('已使用 2 次');
  });

  it('keeps pending generic tool approvals focused on the decision instead of raw JSON previews', () => {
    const html = renderedHtml([
      {
        ...toolRun('fetch_web', 'mcp search-mcp fetchWebContent', {
          url: 'https://news.qq.com/',
          maxChars: 15000,
        }, 'pending_approval'),
        approvalId: 'approval_1',
        approvalReason: '调用 MCP 工具：ziylike Search MCP / fetchWebContent',
      },
    ]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('等待授权：获取网页');
    expect(text).toContain('news.qq.com/');
    expect(text).toContain('允许');
    expect(text).toContain('拒绝');
    expect(text).not.toContain('调用 MCP 工具');
    expect(text).not.toContain('maxChars');
    expect(html).not.toContain('chat-tool-run__preview');
  });

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

  it('renders final file changes as review links with file icons', () => {
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
    expect(html).toContain('class="chat-file-changes__file-icon"');
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
    expect(text).toContain('+15-10');
    expect(text).toContain('再显示 2 个文件');
    expect(html.match(/class="chat-file-changes__item"/gu)).toHaveLength(3);
    expect(html).toContain('src/file-3.ts');
    expect(html).not.toContain('src/file-4.ts');
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

function shellRun(status: RuntimeToolRun['status']): RuntimeToolRun {
  return {
    id: `call_${status}`,
    name: 'run_shell_command',
    status,
    argumentsPreview: '{"command":"pnpm test"}',
    resultPreview: status === 'running' ? 'stdout: running\n' : '$ pnpm test\nexit: 0',
  };
}

function toolRun(id: string, name: string, args: Record<string, unknown>, status: RuntimeToolRun['status'] = 'success'): RuntimeToolRun {
  return {
    id,
    name,
    status,
    argumentsPreview: JSON.stringify(args),
    resultPreview: name === 'run_shell_command' ? `$ ${String(args.command ?? '')}\nexit: 0` : undefined,
  };
}

function fileRun(id: string, name: string, path: string, action: string): RuntimeToolRun {
  return {
    ...toolRun(id, name, { file_path: path }),
    resultPreview: JSON.stringify({
      diff: {
        path,
        action,
        additions: action === 'Created' ? 12 : 1,
        deletions: action === 'Created' ? 0 : 1,
        truncated: false,
        lines: [],
      },
    }),
  };
}

function groupLabel(group: ReturnType<typeof groupToolRuns>[number]): string {
  return group.type === 'group' ? `${group.kind}:${group.runs.length}` : `single:${group.run.name}`;
}

function renderedText(runs: RuntimeToolRun[], summaryMode?: 'aggregate' | 'latest'): string {
  return renderedTextFromHtml(renderedHtml(runs, summaryMode));
}

function renderedTextFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function renderedHtml(runs: RuntimeToolRun[], summaryMode?: 'aggregate' | 'latest'): string {
  const html = renderToStaticMarkup(createElement(RuntimeToolRuns, { runs, summaryMode, onAnswerApproval: () => undefined }));
  return html;
}
