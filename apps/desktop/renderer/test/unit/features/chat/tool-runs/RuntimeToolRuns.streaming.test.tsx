// @vitest-environment happy-dom

import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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
  it('keeps a new approval actionable when consecutive generic calls are compacted inside mixed history', () => {
    const history = [
      toolRun('read_first', 'read_file', { file_path: 'README.md' }),
      toolRun('search_first', 'search_tools', { query: 'agent' }),
      toolRun('search_second', 'search_tools', { query: 'subagent' }),
    ];
    const onAnswerApproval = vi.fn();
    const view = render(panel(history, onAnswerApproval));
    const root = outerDetails(view.container);
    setOpen(root, true);
    const file = view.getByText('README.md');
    const pending = {
      ...toolRun('search_pending', 'search_tools', { query: 'delegate' }, 'pending_approval'),
      approvalId: 'approval_search',
    };

    view.rerender(panel([...history, pending], onAnswerApproval));
    fireEvent.click(view.getByRole('button', { name: '允许' }));
    expect(onAnswerApproval).toHaveBeenCalledWith('approval_search', { decision: 'approve' });

    view.rerender(panel([...history, { ...pending, status: 'success', approvalId: undefined }], onAnswerApproval));
    expect(view.queryByRole('button', { name: '允许' })).toBeNull();
    expect(outerDetails(view.container)).toBe(root);
    expect(root.open).toBe(true);
    expect(view.getByText('README.md')).toBe(file);
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

});
