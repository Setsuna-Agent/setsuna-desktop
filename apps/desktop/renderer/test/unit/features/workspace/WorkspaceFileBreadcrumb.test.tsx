// @vitest-environment happy-dom

import type { WorkspaceEntrySearchItem, WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { WorkspaceFileBreadcrumb } from '../../../../src/features/workspace/WorkspaceFileBreadcrumb.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

function listing(...entries: WorkspaceEntrySearchItem[]): WorkspaceEntrySearchResponse {
  return { entries, query: '', scanned: entries.length, truncated: false, workspaceRoot: '/repo' };
}

function surface(props: Partial<ComponentProps<typeof WorkspaceFileBreadcrumb>>) {
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><WorkspaceFileBreadcrumb
    workspaceKey="project-a" rootLabel="Repo" path="src/current.ts" disabled={false}
    searchEntries={vi.fn()} onOpenEntry={vi.fn()} {...props} />
  </ToastProvider></I18nProvider>;
}

it('loads only opened directories and opens the selected nested file with its full relative path', async () => {
  const searchEntries = vi.fn(async (_query?: string, parent?: string | null) => parent === 'src'
    ? listing(
      { kind: 'directory', name: 'nested', path: 'src/nested', parent: 'src' },
      { kind: 'file', name: 'current.ts', path: 'src/current.ts', parent: 'src' },
    ) : listing({ kind: 'file', name: 'current.ts', path: 'src/nested/current.ts', parent: 'src/nested' }));
  const onOpenEntry = vi.fn();
  render(surface({ searchEntries, onOpenEntry }));
  expect(searchEntries).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'current.ts' }));
  const popup = within(await screen.findByRole('dialog', { name: 'src' }));
  fireEvent.click(await popup.findByRole('button', { name: 'src/nested' }));
  expect(onOpenEntry).not.toHaveBeenCalled();
  fireEvent.click(await popup.findByRole('button', { name: 'src/nested/current.ts' }));

  expect(searchEntries.mock.calls).toEqual([['', 'src'], ['', 'src/nested']]);
  expect(onOpenEntry).toHaveBeenCalledExactlyOnceWith({ type: 'file', name: 'current.ts', path: 'src/nested/current.ts' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it.each(['success', 'failure'] as const)('ignores a previous workspace’s late directory %s after switching roots', async (outcome) => {
  let finishRead!: (result: WorkspaceEntrySearchResponse) => void;
  let failRead!: (error: Error) => void;
  const oldRequest = new Promise<WorkspaceEntrySearchResponse>((resolve, reject) => {
    finishRead = resolve;
    failRead = reject;
  });
  const oldSearch = vi.fn(() => oldRequest);
  const onOpenEntry = vi.fn();
  const view = render(surface({ searchEntries: oldSearch, onOpenEntry }));
  fireEvent.click(screen.getByRole('button', { name: 'src' }));
  await waitFor(() => expect(oldSearch).toHaveBeenCalledExactlyOnceWith('', 'src'));

  const searchEntries = vi.fn(async () => listing({ kind: 'file', name: 'new.ts', path: 'src/new.ts', parent: 'src' }));
  view.rerender(surface({ workspaceKey: 'project-b', searchEntries, onOpenEntry }));
  fireEvent.click(screen.getByRole('button', { name: 'src' }));
  const popup = within(await screen.findByRole('dialog', { name: 'src' }));
  await popup.findByRole('button', { name: 'src/new.ts' });
  await act(async () => {
    if (outcome === 'success') finishRead(listing({ kind: 'file', name: 'old.ts', path: 'src/old.ts', parent: 'src' }));
    else failRead(new Error('old workspace read failed'));
    await oldRequest.catch(() => undefined);
  });

  expect(popup.queryByRole('button', { name: 'src/old.ts' })).toBeNull();
  expect(screen.queryByText('old workspace read failed')).toBeNull();
  fireEvent.click(popup.getByRole('button', { name: 'src/new.ts' }));
  expect(onOpenEntry).toHaveBeenCalledExactlyOnceWith({ type: 'file', name: 'new.ts', path: 'src/new.ts' });
});
