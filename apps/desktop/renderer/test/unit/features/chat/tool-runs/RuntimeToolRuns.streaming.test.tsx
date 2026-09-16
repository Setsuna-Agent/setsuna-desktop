// @vitest-environment happy-dom

import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeToolRuns } from '../../../../../src/features/chat/tool-runs/RuntimeToolRuns.js';
import { withRendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';
import { fileRunWithDiff, toolRun } from './RuntimeToolRuns.support.js';

afterEach(cleanup);

function setOpen(details: HTMLDetailsElement, open: boolean) {
  act(() => {
    details.open = open;
    fireEvent(details, new Event('toggle'));
  });
}

function panel(runs: RuntimeToolRun[], onAnswerApproval = vi.fn()) {
  return withRendererPluginTestHost(<RuntimeToolRuns
    runs={runs}
    onAnswerApproval={onAnswerApproval}
    summaryMode={runs.some((run) => run.status === 'running' || run.status === 'pending_approval') ? 'latest' : 'aggregate'}
  />);
}

function outerDetails(container: HTMLElement): HTMLDetailsElement {
  return container.querySelector<HTMLDetailsElement>('.chat-tool-runs > details')!;
}

describe('RuntimeToolRuns streaming history', () => {
  it.each(['shell', 'mixed'])('shows aggregate history when a %s group is expanded and live activity only when collapsed', (kind) => {
    const completed = [toolRun('shell_first', 'exec_command', { cmd: 'git status --short' })];
    if (kind === 'mixed') completed.push(toolRun('read_first', 'read_file', { file_path: 'src/first.ts' }));
    const running = toolRun('shell_current', 'exec_command', { cmd: 'echo current' }, 'running');
    const view = render(panel([...completed, running]));
    const root = outerDetails(view.container);
    const summary = root.querySelector(':scope > summary')!;
    expect(summary.textContent).toContain('echo current');
    setOpen(root, true);
    const aggregate = summary.textContent;
    expect(aggregate).toBe(kind === 'mixed' ? '已运行 1 条命令，正在运行 1 条命令，已读取 1 个文件' : '已运行 1 条命令，正在运行 1 条命令');
    expect(aggregate).not.toContain('echo current');
    const updated = { ...running, argumentsPreview: JSON.stringify({ cmd: 'echo updated' }) };
    view.rerender(panel([...completed, updated]));
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(true);
    expect(summary.textContent).toBe(aggregate);
    expect(root.querySelector(':scope > .chat-tool-run__body')?.textContent).toContain('echo updated');
    setOpen(root, false);
    expect(summary.textContent).toContain('echo updated');
    setOpen(root, true);
    view.rerender(panel([...completed, { ...updated, status: 'success' }]));
    expect(summary.textContent).toBe(kind === 'mixed' ? '已运行 2 条命令，已读取 1 个文件' : '已运行 2 条命令');
  });

  it('keeps expanded history and command details mounted between successive tool runs', () => {
    const history = [
      { ...toolRun('shell_first', 'exec_command', { cmd: 'git status --short' }), resultPreview: 'Stdout:\nfirst command output' },
      toolRun('read_first', 'read_file', { file_path: 'src/first.ts' }),
    ];
    const view = render(panel(history));
    const root = outerDetails(view.container);
    setOpen(root, true);
    const command = root.querySelector<HTMLDetailsElement>('details.chat-tool-run--shell')!;
    setOpen(command, true);
    const output = view.getByText('first command output');
    const firstFile = view.getByText('first.ts');

    for (const id of ['shell_second', 'shell_third']) {
      const next = toolRun(id, 'exec_command', { cmd: `echo ${id}` }, 'running');
      for (const status of ['running', 'success'] as const) {
        view.rerender(panel([...history, { ...next, status }]));
        expect(outerDetails(view.container)).toBe(root);
        expect(root.open).toBe(true);
        expect(command.isConnected).toBe(true);
        expect(command.open).toBe(true);
        expect(view.getByText('first command output')).toBe(output);
        expect(view.getByText('first.ts')).toBe(firstFile);
      }
      history.push({ ...next, status: 'success' });
    }
    setOpen(root, false);
    view.rerender(panel([...history, toolRun('read_next', 'read_file', { file_path: 'src/next.ts' }, 'running')]));
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(false);
  });

  it('preserves expansion through regrouping and only auto-opens a new approval', () => {
    const first = toolRun('shell_first', 'exec_command', { cmd: 'git status --short' }, 'running');
    const view = render(panel([first]));
    const root = outerDetails(view.container);
    setOpen(root, true);
    const history = [{ ...first, status: 'success' as const }, toolRun('shell_second', 'exec_command', { cmd: 'git log -1' })];
    view.rerender(panel(history));
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(true);
    history.push(toolRun('read_first', 'read_file', { file_path: 'README.md' }));
    view.rerender(panel(history));
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(true);

    const pending = {
      ...toolRun('shell_pending', 'exec_command', { cmd: 'pnpm dev' }, 'pending_approval'),
      approvalId: 'approval_first',
    };
    setOpen(root, false);
    view.rerender(panel([...history, pending]));
    expect(root.open).toBe(true);
    setOpen(root, false);
    view.rerender(panel([...history, { ...pending, resultPreview: 'approval details updated' }]));
    expect(root.open).toBe(false);
    view.rerender(panel([...history, { ...pending, status: 'running', approvalId: undefined }]));
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(false);
    view.rerender(panel([...history, { ...pending, approvalId: 'approval_second' }]));
    expect(root.open).toBe(true);
  });

  it('keeps file diffs mounted as a mutation group grows and exposes each pending decision', () => {
    const history = [
      toolRun('shell_first', 'exec_command', { cmd: 'git status --short' }),
      fileRunWithDiff('edit_first', 'edit_file', 'src/first.ts'),
    ];
    const onAnswerApproval = vi.fn();
    const view = render(panel(history, onAnswerApproval));
    const root = outerDetails(view.container);
    setOpen(root, true);
    const firstDiff = root.querySelector<HTMLDetailsElement>('.chat-file-diff__disclosure')!;
    setOpen(firstDiff, true);
    const pending = {
      ...fileRunWithDiff('edit_second', 'edit_file', 'src/second.ts', 'pending_approval'),
      approvalId: 'approval_edit',
    };
    view.rerender(panel([...history, pending], onAnswerApproval));
    expect(firstDiff.isConnected).toBe(true);
    expect(firstDiff.open).toBe(true);
    const approve = view.getByRole('button', { name: '允许' });
    fireEvent.click(approve);
    expect(onAnswerApproval).toHaveBeenCalledTimes(1);
    expect(onAnswerApproval.mock.calls[0][0]).toBe('approval_edit');
    view.rerender(panel([...history, { ...pending, status: 'success', approvalId: undefined }], onAnswerApproval));
    expect(firstDiff.isConnected).toBe(true);
    expect(firstDiff.open).toBe(true);
    expect(root.open).toBe(true);
  });

  it('retains completed reads without labeling a pending read as completed', () => {
    const completed = toolRun('read_first', 'read_file', { file_path: 'src/first.ts' });
    const next = toolRun('read_next', 'read_file', { file_path: 'src/next.ts' }, 'running');
    const onAnswerApproval = vi.fn();
    const view = render(panel([completed, next], onAnswerApproval));
    const root = outerDetails(view.container);
    setOpen(root, true);
    const list = within(root.querySelector('ul')!);
    const first = list.getByText('first.ts').closest('li');
    const second = list.getByText('next.ts').closest('li');
    expect(second?.textContent).toContain('正在读取文件');
    view.rerender(panel([completed, { ...next, status: 'pending_approval', approvalId: 'approval_read' }], onAnswerApproval));
    expect(list.getByText('first.ts').closest('li')).toBe(first);
    expect(list.getByText('next.ts').closest('li')).toBe(second);
    expect(second?.textContent).toContain('等待授权');
    expect(second?.textContent).not.toContain('已读取');
    fireEvent.click(view.getByRole('button', { name: '允许' }));
    expect(onAnswerApproval).toHaveBeenCalledTimes(1);
    expect(onAnswerApproval.mock.calls[0][0]).toBe('approval_read');
  });
});
