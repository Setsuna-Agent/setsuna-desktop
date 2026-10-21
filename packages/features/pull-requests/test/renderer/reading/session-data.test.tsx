// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestDetail, PullRequestDiscussion, PullRequestListResult } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { PullRequestDetailPane } from '../../../src/renderer/PullRequestDetailPane.js';
import { createPullRequestSession, getPullRequestDetailSession } from '../../../src/renderer/session.js';
import { createPullRequestDetailData, createPullRequestListData } from '../../../src/renderer/reading/session-data.js';
import { usePullRequestFiles } from '../../../src/renderer/usePullRequestFiles.js';
import { usePullRequestList } from '../../../src/renderer/usePullRequestList.js';
import { readRequest, summary } from '../../../src/runtime/pull-requests.js';
import { commentNode, githubFixture, reference, repositoryNode, summaryNode } from '../../support/github-fixture.js';
import { RendererHost } from '../../support/renderer-host.js';

afterEach(cleanup);
const readDetail = () => readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('reopens the complete PR immediately, retains it on refresh failure and isolates another account', async () => {
  const pr = { ...await readDetail(), body: 'Saved PR description' };
  const discussion: PullRequestDiscussion = {
    id: 'D1', kind: 'comment', state: null, resolved: false, outdated: false, canReply: true,
    path: null, line: null, side: null, diffHunk: null, commitSha: null,
    comments: [commentNode('C1', 'Saved discussion')], replyCursor: null,
  };
  const client = {
    detail: vi.fn<PullRequestsClient['detail']>().mockResolvedValue(pr),
    discussions: vi.fn<PullRequestsClient['discussions']>().mockImplementation(async ({ kind }) => ({
      items: kind === 'comments' ? [discussion] : [], cursor: null,
    })),
    activity: vi.fn<PullRequestsClient['activity']>().mockResolvedValue({ items: [], cursor: null }),
    checks: vi.fn<PullRequestsClient['checks']>().mockResolvedValue({ items: [{
      id: 'CI', name: 'Build', source: 'CI', state: 'COMPLETED', conclusion: 'FAILURE', required: true,
      url: null, startedAt: null, completedAt: null, summary: 'Saved check result',
    }], cursor: null }),
  };
  const session = createPullRequestSession();
  const pane = (account: string) => <PullRequestDetailPane client={client as unknown as PullRequestsClient}
    reference={reference} account={account} session={getPullRequestDetailSession(session, account, reference)} onUpdated={vi.fn()} />;
  let view = render(pane('alice'), { wrapper: RendererHost });
  await screen.findByText('Saved discussion');
  await screen.findByText('Saved check result');
  view.unmount();

  const refresh = deferred<PullRequestDetail>();
  client.detail.mockImplementationOnce(() => refresh.promise);
  client.discussions.mockImplementation(() => new Promise(() => undefined));
  client.activity.mockImplementation(() => new Promise(() => undefined));
  client.checks.mockImplementation(() => new Promise(() => undefined));
  view = render(pane('alice'), { wrapper: RendererHost });
  for (const text of ['Saved PR description', 'Saved discussion', 'Saved check result']) expect(screen.getByText(text)).toBeTruthy();
  await act(async () => refresh.reject(new Error('Offline')));
  expect(screen.getByRole('alert').textContent).toContain('Offline');
  expect(screen.getByText('Saved PR description')).toBeTruthy();
  expect(screen.getByText('Saved discussion')).toBeTruthy();
  view.unmount();

  client.detail.mockImplementation(() => new Promise(() => undefined));
  render(pane('bob'), { wrapper: RendererHost });
  for (const text of ['Saved PR description', 'Saved discussion', 'Saved check result']) expect(screen.queryByText(text)).toBeNull();
});

it('restores all list pages before revalidation and hides them when account or filters change', async () => {
  const list = vi.fn<PullRequestsClient['list']>().mockImplementation(async ({ cursor }) => ({
    items: [summary(summaryNode(cursor ? 2 : 1), reference.repository)], cursor: cursor ? null : 'next',
  }));
  const client = {
    list, repositories: vi.fn(async () => ({
      repositories: [{ id: reference.repository, fullName: reference.repository, projects: [], remotes: [] }], issues: [],
    })),
  } as unknown as PullRequestsClient;
  const data = createPullRequestListData();
  const read = ({ account, search }: { account: string; search: string }) =>
    usePullRequestList(client, account, '', { state: 'all', author: '', search }, data);
  let hook = renderHook(read, { initialProps: { account: 'alice', search: '' } });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(() => hook.result.current.more());
  hook.unmount();

  const refresh = deferred<PullRequestListResult>();
  list.mockImplementationOnce(() => refresh.promise);
  hook = renderHook(read, { initialProps: { account: 'alice', search: '' } });
  expect(hook.result.current.items.map((item) => item.number)).toEqual([1, 2]);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  await act(async () => refresh.resolve({ items: [summary(summaryNode(1), reference.repository)], cursor: 'next' }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.items.map((item) => item.number)).toEqual([1, 2]);
  expect(list).toHaveBeenCalledTimes(4);

  const cancelled = deferred<PullRequestListResult>();
  list.mockImplementationOnce(() => cancelled.promise);
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(list).toHaveBeenCalledTimes(5));
  const oldSignal = list.mock.calls.at(-1)![1]!;
  list.mockImplementation(() => new Promise(() => undefined));
  hook.rerender({ account: 'bob', search: '' });
  expect(hook.result.current.items).toEqual([]);
  expect(oldSignal.aborted).toBe(true);
  await act(async () => cancelled.resolve({ items: [summary(summaryNode(99), reference.repository)], cursor: null }));
  expect(hook.result.current.items).toEqual([]);
  hook.rerender({ account: 'alice', search: 'different' });
  expect(hook.result.current.items).toEqual([]);
});

it('resumes unfinished diff pages, reuses completed data and discards it for another commit', async () => {
  const pr = await readDetail();
  const file = (path: string) => ({ path, previousPath: null, status: 'modified', additions: 1, deletions: 1 });
  type FilesPage = Awaited<ReturnType<PullRequestsClient['files']>>;
  const cancelled = deferred<FilesPage>();
  const files = vi.fn<PullRequestsClient['files']>()
    .mockResolvedValueOnce({ files: [file('a.ts')], nextPage: 2, total: 2, reset: false })
    .mockImplementationOnce(() => cancelled.promise);
  const patch = vi.fn<PullRequestsClient['patch']>().mockImplementation(async ({ headSha }) => ({ kind: 'text', patch: headSha }));
  const client = { files, patch } as unknown as PullRequestsClient;
  const data = createPullRequestDetailData();
  const read = ({ headSha }: { headSha: string }) => usePullRequestFiles(client, { ...pr, headSha }, 'a.ts', data);
  let hook = renderHook(read, { initialProps: { headSha: pr.headSha } });
  await waitFor(() => expect(hook.result.current.patch?.patch).toBe(pr.headSha));
  const oldSignal = files.mock.calls.at(-1)![1]!;
  hook.unmount();
  expect(oldSignal.aborted).toBe(true);

  const resumed = deferred<FilesPage>();
  files.mockImplementationOnce(() => resumed.promise);
  hook = renderHook(read, { initialProps: { headSha: pr.headSha } });
  expect(hook.result.current.files.map((item) => item.path)).toEqual(['a.ts']);
  expect(hook.result.current.patch?.patch).toBe(pr.headSha);
  expect(files).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
  expect(patch).toHaveBeenCalledOnce();
  await act(async () => cancelled.resolve({ files: [file('stale.ts')], nextPage: null, total: 2, reset: false }));
  expect(hook.result.current.files.map((item) => item.path)).toEqual(['a.ts']);
  await act(async () => resumed.resolve({ files: [file('b.ts')], nextPage: null, total: 2, reset: false }));
  hook.unmount();

  hook = renderHook(read, { initialProps: { headSha: pr.headSha } });
  expect(hook.result.current.files.map((item) => item.path)).toEqual(['a.ts', 'b.ts']);
  expect(hook.result.current.patch?.patch).toBe(pr.headSha);
  expect(files).toHaveBeenCalledTimes(3);
  expect(patch).toHaveBeenCalledOnce();

  const changed = deferred<FilesPage>();
  files.mockImplementationOnce(() => changed.promise);
  hook.rerender({ headSha: 'new-commit' });
  expect(hook.result.current.files).toEqual([]);
  expect(hook.result.current.patch).toBeNull();
  await act(async () => changed.resolve({ files: [file('a.ts')], nextPage: null, total: 1, reset: false }));
  await waitFor(() => expect(hook.result.current.patch?.patch).toBe('new-commit'));
});
