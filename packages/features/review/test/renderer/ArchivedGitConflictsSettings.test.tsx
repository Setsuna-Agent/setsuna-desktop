// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { forwardRef, useEffect, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createNoopReviewRendererService, type WorkspaceGitConflictTask } from '../../src/contracts/index.js';
import { ArchivedGitConflictsSettings } from '../../src/renderer/ArchivedGitConflictsSettings.js';
import { ReviewRendererProvider, useGitConflictTasks } from '../../src/renderer/context.js';
import { translateReviewMessage, type ReviewMessageKey } from '../../src/renderer/messages.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(cleanup);
type Props = ComponentProps<typeof ArchivedGitConflictsSettings>;
const ui: Props['ui'] = {
  Section: ({ children }) => <div>{children}</div>,
  Group: ({ title, children }) => <section aria-label={String(title)}>{children}</section>,
  Row: ({ className, label, description, children }) => <div className={className}>{label}{description}{children}</div>,
  Button: ({ children, icon: _icon, ...props }) => <button {...props}>{children}</button>,
  IconButton: forwardRef<HTMLButtonElement, ComponentProps<Props['ui']['IconButton']>>(function TestIconButton({ children, label, variant: _variant, ...props }, ref) {
    return <button ref={ref} aria-label={label} {...props}>{children}</button>;
  }),
  EmptyState: ({ title }) => <p>{title}</p>,
  Toast: ({ message }) => <p role="alert">{message}</p>,
  Dialog: ({ title, children, onClose, closeLabel }) => <section role="dialog" aria-label={String(title)}><button onClick={onClose}>{closeLabel}</button>{children}</section>,
};
const translate: Props['translate'] = (key, params) => translateReviewMessage('zh-CN', key as ReviewMessageKey, params);
const cached: WorkspaceGitConflictTask = { threadId: 'repair', turnId: 'repair-turn', createdAt: '2026-09-10T00:00:00Z', operation: 'rebase', archived: true, workspaceRoot: '/real/repo' };

function CachedPanel() {
  const { tasks, recordTasks } = useGitConflictTasks();
  useEffect(() => recordTasks('/repo-alias', [cached]), [recordTasks]);
  return <>
    <button onClick={() => recordTasks('/repo-alias', [cached])}>Replay old history</button>
    <output aria-label="Existing panel archive state">{String(tasks.get('/repo-alias')?.[0]?.archived)}</output>
    <output aria-label="Unvisited project archive state">{String(tasks.get('/other')?.[0]?.archived)}</output>
  </>;
}

it('shows archives from multiple projects, previews their original task, and restores into cached or unvisited change panels', async () => {
  let records = [cached, { ...cached, threadId: 'second', turnId: 'second-turn', workspaceRoot: '/other', operation: 'pull' as const }];
  const client: Props['client'] = {
    deleteGitConflictTask: vi.fn(),
    readArchivedGitConflicts: vi.fn(async () => records),
    setGitConflictArchived: vi.fn(async ({ threadId, archived }) => {
      const task = records.find((entry) => entry.threadId === threadId)!;
      records = records.filter((entry) => entry.threadId !== threadId);
      return { ...task, archived };
    }),
  };
  const view = render(<ReviewRendererProvider service={createNoopReviewRendererService()}><ReviewRendererTestHost>
    <CachedPanel /><ArchivedGitConflictsSettings client={client} translate={translate} ui={ui} />
  </ReviewRendererTestHost></ReviewRendererProvider>);
  const first = (await screen.findByText('/real/repo')).closest('.git-conflict-archive-row') as HTMLElement;
  expect(screen.getByText('/other')).toBeTruthy();
  fireEvent.click(within(first).getByRole('button', { name: '查看过程' }));
  expect(within(screen.getByRole('dialog')).getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('repair');
  fireEvent.click(screen.getByRole('button', { name: '关闭处理过程' }));

  vi.mocked(client.setGitConflictArchived).mockRejectedValueOnce(new Error('Disk unavailable'));
  fireEvent.click(within(first).getByRole('button', { name: '恢复记录' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Disk unavailable');
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('true');
  fireEvent.click(within(first).getByRole('button', { name: '恢复记录' }));
  await waitFor(() => expect(screen.queryByText('/real/repo')).toBeNull());
  expect(client.setGitConflictArchived).toHaveBeenLastCalledWith({ workspaceRoot: '/real/repo', threadId: 'repair', archived: false });
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '恢复记录' }));
  await screen.findByText('暂无已归档记录');
  expect(screen.getByLabelText('Unvisited project archive state').textContent).toBe('false');

  view.unmount();
  render(<ReviewRendererTestHost><ArchivedGitConflictsSettings client={client} translate={translate} ui={ui} /></ReviewRendererTestHost>);
  await screen.findByText('暂无已归档记录');
  expect(client.readArchivedGitConflicts).toHaveBeenCalledTimes(2);
});

it('reports failed archive loading instead of an empty archive, and allows retrying', async () => {
  const client: Props['client'] = {
    deleteGitConflictTask: vi.fn(),
    readArchivedGitConflicts: vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue([cached]),
    setGitConflictArchived: vi.fn(),
  };
  render(<ReviewRendererTestHost><ArchivedGitConflictsSettings client={client} translate={translate} ui={ui} /></ReviewRendererTestHost>);
  expect((await screen.findByRole('alert')).textContent).toContain('Unavailable');
  expect(screen.queryByText('暂无已归档记录')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByText('/real/repo');
});


it('requires delete confirmation, keeps failed records for retry, and evicts deleted tasks even when an old read arrives later', async () => {
  const deleteGitConflictTask = vi.fn<Props['client']['deleteGitConflictTask']>()
    .mockRejectedValueOnce(new Error('Delete failed')).mockResolvedValue({ deleted: true });
  const client: Props['client'] = { readArchivedGitConflicts: async () => [cached], setGitConflictArchived: vi.fn(), deleteGitConflictTask };
  render(<ConfigProvider theme={{ token: { motion: false } }}><ReviewRendererProvider service={createNoopReviewRendererService()}><ReviewRendererTestHost>
    <CachedPanel /><ArchivedGitConflictsSettings client={client} translate={translate} ui={ui} />
  </ReviewRendererTestHost></ReviewRendererProvider></ConfigProvider>);
  const deleteButton = await screen.findByRole('button', { name: '彻底删除' });
  fireEvent.click(deleteButton);
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/u }));
  expect(deleteGitConflictTask).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('true');

  fireEvent.click(deleteButton);
  fireEvent.click(within(await screen.findByRole('tooltip')).getByRole('button', { name: '彻底删除' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Delete failed');
  expect(screen.getByText('/real/repo')).toBeTruthy();
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('true');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  fireEvent.click(deleteButton);
  fireEvent.click(within(await screen.findByRole('tooltip')).getByRole('button', { name: '彻底删除' }));
  await screen.findByText('暂无已归档记录');
  expect(deleteGitConflictTask).toHaveBeenLastCalledWith({ workspaceRoot: '/real/repo', threadId: 'repair' });
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('undefined');
  fireEvent.click(screen.getByRole('button', { name: 'Replay old history' }));
  expect(screen.getByLabelText('Existing panel archive state').textContent).toBe('undefined');
});
