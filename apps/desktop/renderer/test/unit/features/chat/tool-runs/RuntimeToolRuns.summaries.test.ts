import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { toolRun, fileRun, preparingFileRun, renderedText, renderedTextFromHtml, firstToolRunSummaryHtml, renderedHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns compact summaries', () => {
  it('shows the search scope alongside the query when a path is available', () => {
    const completedSummary = firstToolRunSummaryHtml(renderedHtml([
      toolRun('search_file', 'search_text', {
        path: 'apps/desktop/renderer/src/features/chat/hooks/useChatTurnActions.ts',
        query: 'setError',
      }),
    ]));
    const runningSummary = firstToolRunSummaryHtml(renderedHtml([
      toolRun('search_running', 'search_text', { path: 'threads', query: 'needle' }, 'running'),
    ]));
    const projectSummary = firstToolRunSummaryHtml(renderedHtml([
      toolRun('search_root', 'search_text', { path: '.', query: 'TODO' }),
    ]));

    expect(renderedTextFromHtml(completedSummary))
      .toContain('已在 useChatTurnActions.ts 中搜索“setError”');
    expect(renderedTextFromHtml(runningSummary)).toContain('正在 threads 中搜索“needle”');
    expect(renderedTextFromHtml(projectSummary)).toContain('已在 项目根目录 中搜索“TODO”');
  });

  it('keeps the generic search summary when the tool does not provide a path', () => {
    const summary = firstToolRunSummaryHtml(renderedHtml([
      toolRun('workspace_search', 'workspace_search_text', { query: 'needle' }),
    ]));

    expect(renderedTextFromHtml(summary)).toContain('已搜索代码needle');
  });

  it('shows each search scope inside a grouped search disclosure', () => {
    const text = renderedText([
      toolRun('search_controller', 'search_text', { path: 'src/useDesktopAppController.ts', query: 'error:' }),
      toolRun('search_actions', 'search_text', { path: 'src/useChatTurnActions.ts', query: 'setError' }),
    ]);

    expect(text).toContain('已搜索 2 次代码');
    expect(text).toContain('已在 useDesktopAppController.ts 中搜索“error:”');
    expect(text).toContain('已在 useChatTurnActions.ts 中搜索“setError”');
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

    expect(html).toContain('data-markdown-link="workspace-tool"');
    expect(html).toContain('class="chat-markdown__file-icon"');
    expect(html).toMatch(/<a[^>]*chat-tool-run__file-target[^>]*>.*merge_sort\.py.*<\/a><span class="chat-change-counts"/u);
  });

  it('normalizes absolute tool paths through the shared workspace file renderer', () => {
    const html = renderedHtml([
      fileRun('edit_style', 'edit_file', '/Users/dev/project/src/index.css', 'Modified'),
    ]);

    expect(html).toContain('data-markdown-link="workspace-tool"');
    expect(html).toContain('title="src/index.css"');
    expect(html).toContain('<span>index.css</span>');
    expect(html).not.toContain('title="/Users/dev/project/src/index.css"');
  });

  it('uses the shared file renderer in grouped, mixed, and hook-backed summaries', () => {
    const absolutePath = '/Users/dev/project/src/index.css';
    const groupedHtml = renderedHtml([
      fileRun('edit_previous', 'edit_file', absolutePath, 'Modified'),
      preparingFileRun('edit_grouped', absolutePath),
    ]);
    const mixedHtml = renderedHtml([
      toolRun('read_package', 'workspace_read_file', { path: 'package.json' }),
      preparingFileRun('edit_mixed', absolutePath),
    ], 'latest');
    const hookBackedHtml = renderedHtml([{
      ...preparingFileRun('edit_with_hook', absolutePath),
      hookRuns: [{
        id: 'hook_1',
        eventName: 'PreToolUse',
        handlerType: 'command',
        status: 'completed',
      }],
    }]);

    for (const html of [groupedHtml, mixedHtml, hookBackedHtml]) {
      const summaryHtml = firstToolRunSummaryHtml(html);
      expect(summaryHtml).toContain('data-markdown-link="workspace-tool"');
      expect(summaryHtml).toContain('class="chat-markdown__file-icon"');
      expect(summaryHtml).toContain('title="src/index.css"');
      expect(summaryHtml).toContain('<span>index.css</span>');
      expect(renderedTextFromHtml(summaryHtml)).not.toContain(absolutePath);
    }
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

  it('distinguishes file preparation from execution and cancellation', () => {
    const preparing = renderedText([{
      ...toolRun('write_preparing', 'write_file', { file_path: 'src/generated.ts', content: 'partial' }, 'running'),
      phase: 'preparing',
    }]);
    const cancelled = renderedText([
      toolRun('write_cancelled', 'write_file', { file_path: 'src/generated.ts', content: 'partial' }, 'cancelled'),
    ]);

    expect(preparing).toContain('正在生成修改预览（尚未写入）');
    expect(preparing).not.toContain('正在写入');
    expect(preparing).not.toContain('+1-0');
    expect(cancelled).toContain('已取消文件操作');
    expect(cancelled).not.toContain('已拒绝');
  });

  it('does not render zero change counts before a file target is known', () => {
    const html = renderedHtml([{
      id: 'write_preparing',
      name: 'write_file',
      status: 'running',
      phase: 'preparing',
      argumentsPreview: '{',
    }]);

    expect(renderedTextFromHtml(html)).toContain('正在生成修改预览（尚未写入）');
    expect(html).not.toContain('chat-change-counts');
  });

  it('does not render zero change counts before a streamed patch contains changes', () => {
    const zeroDiff = {
      path: 'src/index.css',
      action: 'Edited',
      additions: 0,
      deletions: 0,
      truncated: false,
      partial: true,
      lines: [],
    };
    const run: RuntimeToolRun = {
      id: 'patch_preparing',
      name: 'apply_patch',
      status: 'running',
      phase: 'preparing',
      argumentsPreview: JSON.stringify({
        file_path: 'src/index.css',
        files: [{ file_path: 'src/index.css', action: 'edit', additions: 0, deletions: 0 }],
        complete: false,
      }),
      resultPreview: JSON.stringify({ diff: zeroDiff }),
    };
    const singleHtml = renderedHtml([run]);
    const groupedHtml = renderedHtml([{
      ...run,
      resultPreview: JSON.stringify({
        diff: {
          diffs: [zeroDiff, { ...zeroDiff, path: 'src/App.tsx' }],
        },
      }),
    }]);

    for (const html of [singleHtml, groupedHtml]) {
      expect(renderedTextFromHtml(html)).toContain('index.css');
      expect(html).not.toContain('chat-change-counts');
    }
  });

  it('keeps completed change counts while a later file mutation is preparing', () => {
    const fileRuns = [
      fileRun('edit_completed', 'edit_file', 'src/completed.ts', 'Modified'),
      preparingFileRun('edit_preparing', 'src/preparing.ts'),
    ];
    const directText = renderedTextFromHtml(renderedHtml(fileRuns));
    const mixedText = renderedTextFromHtml(renderedHtml([
      toolRun('read_before_edit', 'read_file', { file_path: 'src/completed.ts' }),
      ...fileRuns,
    ], 'latest'));

    for (const text of [directText, mixedText]) {
      expect(text).toContain('+1-1');
      expect(text).not.toContain('+47-19');
      expect(text).toContain('completed.ts');
    }
  });

  it('does not render a partial streamed workspace root as a file target', () => {
    const html = renderedHtml([{
      id: 'edit_preparing',
      name: 'edit',
      status: 'running',
      phase: 'preparing',
      argumentsPreview: JSON.stringify({
        file_path: '/Users/dev/project',
        file_path_closed: false,
        old_string: '',
        new_string: '',
      }),
    }]);

    expect(renderedTextFromHtml(html)).toBe('正在生成修改预览（尚未写入）');
    expect(html).not.toContain('workspace-tool');
    expect(html).not.toContain('chat-change-counts');
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
});
