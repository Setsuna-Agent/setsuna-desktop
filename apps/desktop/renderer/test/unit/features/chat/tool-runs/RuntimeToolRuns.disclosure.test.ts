import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { groupToolRuns, shouldAutoOpenToolRunDisclosure, toolRunDisplayStableKey } from '../../../../../src/features/chat/tool-runs/RuntimeToolRuns.js';
import { shellRun, toolRun, fileRunWithDiff, hookBearingMultiFileRunWithDiff, groupLabel, renderedTextFromHtml, firstToolRunSummaryHtml, renderedHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns disclosure behavior', () => {
  it('uses disclosure chevrons and per-row action icons for expanded history', () => {
    const html = renderedHtml([
      toolRun('read_first', 'read_file', { file_path: 'src/first.ts' }),
      toolRun('read_second', 'read_file', { file_path: 'src/second.ts' }),
    ]);

    expect(html).toContain('chat-tool-run__chevron');
    expect(html.match(/chat-tool-run__detail-icon/gu)).toHaveLength(2);
  });

  it('keeps ordinary tool details collapsed and opens pending user authorization', () => {
    const pendingApprovalRun: RuntimeToolRun = {
      ...toolRun('user_input_1', 'request_user_input', { message: '请选择配置方式' }, 'pending_approval'),
      approvalId: 'approval_user_input',
    };

    for (const html of [
      renderedHtml([shellRun('running')]),
      renderedHtml([shellRun('success')]),
      renderedHtml([shellRun('running'), toolRun('generic_1', 'some_tool', { input: 'streaming' }, 'running')]),
    ]) {
      expect(html).toContain('<details');
      expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    }

    expect(renderedHtml([pendingApprovalRun])).toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
  });

  it('makes completed file diffs expandable without rendering the closed preview', () => {
    const html = renderedHtml([
      fileRunWithDiff('edit_notice', 'edit_file', 'src/RuntimeErrorNotice.tsx'),
    ]);

    expect(html).toContain('<details');
    expect(html).toContain('chat-tool-run__chevron');
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    expect(html).not.toContain('chat-file-diff__preview');
    expect(renderedTextFromHtml(firstToolRunSummaryHtml(html))).toContain('已编辑RuntimeErrorNotice.tsx+1-1');
  });

  it('opens pending file diffs so changes can be reviewed before approval', () => {
    const pendingRun: RuntimeToolRun = {
      ...fileRunWithDiff('edit_pending', 'edit_file', 'src/pending.ts', 'pending_approval'),
      approvalId: 'approval_edit_pending',
    };
    const html = renderedHtml([pendingRun]);

    expect(html).toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    expect(html).toContain('chat-file-diff__preview');
    expect(html).toContain('diff --git a/src/pending.ts b/src/pending.ts');
    expect(html).toContain('-return &#x27;before&#x27;;');
    expect(html).toContain('+return &#x27;after&#x27;;');
  });

  it('adds an independent diff disclosure for each file in a mutation group', () => {
    const html = renderedHtml([
      fileRunWithDiff('edit_first', 'edit_file', 'src/first.ts'),
      fileRunWithDiff('edit_second', 'edit_file', 'src/second.ts'),
    ]);

    expect(html.match(/chat-file-diff__disclosure/gu)).toHaveLength(2);
    expect(html.match(/chat-file-diff__chevron/gu)).toHaveLength(2);
    expect(html).not.toContain('chat-file-diff__preview');
    expect(renderedTextFromHtml(html)).toContain('编辑first.ts+1-1');
    expect(renderedTextFromHtml(html)).toContain('编辑second.ts+1-1');
  });

  it('keeps every diff available when a multi-file mutation also has hooks', () => {
    const html = renderedHtml([hookBearingMultiFileRunWithDiff()]);

    expect(html).toMatch(/<details[^>]*\bopen(?:=|\s|>)/u);
    expect(html.match(/chat-file-diff__disclosure/gu)).toHaveLength(2);
    expect(renderedTextFromHtml(html)).toContain('编辑first.ts+1-1');
    expect(renderedTextFromHtml(html)).toContain('编辑second.ts+1-1');
    expect(html).toContain('chat-tool-run__hook');
  });

  it('auto-opens each new approval once without overriding a manual collapse during the same request', () => {
    expect(shouldAutoOpenToolRunDisclosure(undefined, 'approval_1')).toBe(true);
    expect(shouldAutoOpenToolRunDisclosure('approval_1', 'approval_1')).toBe(false);
    expect(shouldAutoOpenToolRunDisclosure('approval_1', undefined)).toBe(false);
    expect(shouldAutoOpenToolRunDisclosure('approval_1', 'approval_2')).toBe(true);
  });

  it('keeps the same disclosure identity when a streamed single run becomes a group', () => {
    const firstRun = toolRun('shell_1', 'run_shell_command', { command: 'pnpm typecheck' }, 'running');
    const single = groupToolRuns([firstRun])[0];
    const group = groupToolRuns([
      firstRun,
      toolRun('shell_2', 'run_shell_command', { command: 'pnpm lint' }, 'running'),
    ])[0];

    expect(single).toBeDefined();
    expect(group).toBeDefined();
    expect(toolRunDisplayStableKey(single!)).toBe('shell_1');
    expect(toolRunDisplayStableKey(group!)).toBe('shell_1');
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
});
