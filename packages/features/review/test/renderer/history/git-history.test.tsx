// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopDiffFile, DesktopGitCommit, DesktopGitCommitDetails, DesktopGitHistoryPage, DesktopReviewBridge, DesktopReviewState } from '../../../src/contracts/index.js';
import { GitChangesPanel } from '../../../src/renderer/history/GitChangesPanel.js';
import { GitHistoryGraph } from '../../../src/renderer/history/GitHistoryGraph.js';
import { useGitCommitFile } from '../../../src/renderer/history/useGitCommit.js';
import { useGitHistory } from '../../../src/renderer/history/useGitHistory.js';
import { layoutGitHistory, GIT_GRAPH_ROW_HEIGHT } from '../../../src/renderer/history/gitGraph.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const one = 'a'.repeat(40);
const two = 'b'.repeat(40);
const file = (path: string, patch = ''): DesktopDiffFile => ({ path, action: 'Modified', additions: 1, deletions: 1, truncated: false, lines: [], patch });
const commit = (oid: string, parents: string[] = []): DesktopGitCommit => ({ oid, parents, subject: 'Commit ' + oid.slice(0, 8), author: 'Author', authoredAt: '2026-09-09T10:00:00Z' });
const state: DesktopReviewState = {
  workspaceRoot: '/repo', gitRoot: '/repo', isGitRepository: true, currentBranch: 'main',
  currentRemoteRef: null, baseRef: null, baseRefs: [], branches: [], currentRemoteSummary: null, branchSummary: null,
  stagedSummary: { files: [file('staged.txt')], additions: 1, deletions: 1 },
  unstagedSummary: { files: [file('working.txt')], additions: 1, deletions: 1 },
};
const page = (commits = [commit(one, [two]), commit(two)]): DesktopGitHistoryPage => ({
  gitRoot: '/repo', head: one, currentBranch: 'main', tip: one, commits, nextSkip: null,
  refs: [{ name: 'refs/heads/feature', label: 'feature', kind: 'local', oid: two }],
});
const noop = () => undefined;
const actions = {
  workspaceApps: [], onAddFileToConversation: noop, onCopyFilePath: noop, onExternalOpenFile: noop,
  onOpenFileWithApp: noop, onOpenProjectFile: noop, onRevealFile: noop,
};

function host(bridge: Partial<DesktopReviewBridge>, clipboard: {
  copyText?: (value: string) => Promise<void>;
  notifyError?: (message: string) => void;
  openExternal?: (url: string) => Promise<boolean>;
} = {}) {
  return ({ children }: PropsWithChildren) => <ReviewRendererTestHost bridge={bridge as DesktopReviewBridge} {...clipboard}>{children}</ReviewRendererTestHost>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('Git change navigation', () => {
  it('selects the first diff after worktree data arrives and preserves an explicit file selection on refresh', () => {
    const renderPanel = (reviewState: DesktopReviewState | null, reviewLoading: boolean) => (
      <GitChangesPanel workspaceRoot="/repo" reviewState={reviewState} reviewError={null}
        reviewLoading={reviewLoading} onRefresh={noop} actions={actions} />
    );
    const view = render(renderPanel(null, true), { wrapper: host({ getHistory: vi.fn().mockResolvedValue(page()) }) });
    view.rerender(renderPanel(state, false));
    const detail = () => within(view.container.querySelector<HTMLElement>('.git-history-diff')!);
    const nav = within(screen.getByRole('navigation', { name: '变更' }));
    expect(detail().getByText('staged.txt')).toBeTruthy();
    expect(nav.getByRole('button', { name: 'staged.txt' }).getAttribute('aria-pressed')).toBe('true');
    expect(view.container.querySelector('.git-changes-panel__body.has-detail')).toBeTruthy();

    fireEvent.click(nav.getByRole('button', { name: 'working.txt' }));
    view.rerender(renderPanel({ ...state }, false));
    expect(detail().getByText('working.txt')).toBeTruthy();
    expect(nav.getByRole('button', { name: 'working.txt' }).getAttribute('aria-pressed')).toBe('true');
    expect(detail().queryByText('staged.txt')).toBeNull();

    view.rerender(renderPanel({ ...state, stagedSummary: null, unstagedSummary: null }, false));
    expect(detail().getByText('没有变更文件')).toBeTruthy();
  });

  it.each([
    { workspaceRoot: '/repo/packages/app', gitRoot: '/repo' },
    { workspaceRoot: 'C:\\repo\\packages\\app', gitRoot: 'C:\\repo' },
  ])('opens workspace-relative files from changes and history under $workspaceRoot', async ({ workspaceRoot, gitRoot }) => {
    const inside = file('packages/app/src/index.ts');
    const outside = file('packages/other/src/outside.ts');
    const deleted = { ...file('packages/app/src/deleted.ts'), action: 'Deleted' as const };
    const getHistory = vi.fn().mockResolvedValue({ ...page(), gitRoot });
    const getCommitDetails = vi.fn().mockResolvedValue({ commit: commit(one), message: 'Commit', baseOid: null, files: [inside, outside, deleted] });
    const getCommitFileDiff = vi.fn().mockResolvedValue(inside);
    const onOpenProjectFile = vi.fn();
    render(<GitChangesPanel workspaceRoot={workspaceRoot} reviewState={{
      ...state, workspaceRoot, gitRoot,
      stagedSummary: { files: [inside], additions: 1, deletions: 1 },
      unstagedSummary: { files: [outside, deleted], additions: 1, deletions: 2 },
    }} reviewError={null} reviewLoading={false} onRefresh={noop} actions={{ ...actions, onOpenProjectFile }} />, {
      wrapper: host({ getHistory, getCommitDetails, getCommitFileDiff }),
    });
    const nav = within(screen.getByRole('navigation', { name: '变更' }));
    const openButton = (filename: string) => within(nav.getByRole('button', { name: new RegExp(filename) })
      .closest<HTMLElement>('.git-changes-file')!).getByRole<HTMLButtonElement>('button', { name: '打开文件' });
    for (const source of ['worktree', 'commit']) {
      if (source === 'commit') {
        fireEvent.click(await nav.findByRole('button', { name: /Commit aaaaaaaa/ }));
        await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledOnce());
      }
      onOpenProjectFile.mockClear();
      fireEvent.click(openButton('index.ts'));
      expect(onOpenProjectFile).toHaveBeenCalledExactlyOnceWith('src/index.ts');
      for (const filename of ['outside.ts', 'deleted.ts']) {
        const button = openButton(filename);
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
      }
      expect(onOpenProjectFile).toHaveBeenCalledOnce();
    }
  });

  it('opens worktree files and lazily loads commit files, with branch browsing separate from checkout', async () => {
    const getHistory = vi.fn().mockResolvedValue(page());
    const getCommitDetails = vi.fn().mockImplementation(async (_root: string, oid: string) => ({ commit: commit(oid), message: commit(oid).subject, baseOid: null, files: [file('a.ts'), file('b.ts')] }));
    const getCommitFileDiff = vi.fn().mockImplementation(async (_root: string, input: { filePath: string }) => file(input.filePath));
    const checkoutBranch = vi.fn();
    render(<GitChangesPanel workspaceRoot="/repo" reviewState={state} reviewError={null} reviewLoading={false} onRefresh={noop} actions={actions} />, {
      wrapper: host({ getHistory, getCommitDetails, getCommitFileDiff, checkoutBranch }),
    });
    const nav = within(screen.getByRole('navigation', { name: '变更' }));
    fireEvent.click(nav.getByRole('button', { name: /working.txt/ }));
    expect(nav.getByRole('button', { name: /working.txt/ }).getAttribute('aria-pressed')).toBe('true');
    expect(getCommitDetails).not.toHaveBeenCalled();
    fireEvent.click(await nav.findByRole('button', { name: /Commit aaaaaaaa/ }));
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledWith('/repo', { oid: one, filePath: 'a.ts', previousPath: undefined }));
    expect(getCommitFileDiff).toHaveBeenCalledTimes(1);
    fireEvent.click(nav.getByRole('button', { name: /b.ts/ }));
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenLastCalledWith('/repo', { oid: one, filePath: 'b.ts', previousPath: undefined }));
    fireEvent.click(nav.getByRole('button', { name: 'feature' }));
    await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith('/repo', { ref: 'refs/heads/feature' }));
    expect(getCommitDetails).toHaveBeenLastCalledWith('/repo', two);
    expect(checkoutBranch).not.toHaveBeenCalled();
    fireEvent.click(nav.getByRole('button', { name: /工作区更改/ }));
    expect(nav.getByRole('button', { name: /staged.txt/ })).toBeTruthy();
  });

  it('targets the right-clicked commit for copying and opening changes without selecting it merely to copy', async () => {
    const message = 'Commit bbbbbbbb\n\n完整正文，不是被截断的标题。\n\nReviewed-by: Example';
    const getHistory = vi.fn().mockResolvedValue(page());
    const getCommitDetails = vi.fn().mockImplementation(async (_root: string, oid: string) => ({
      commit: commit(oid), message: oid === two ? message : 'Another commit', baseOid: null, files: [file('a.ts')],
    }));
    const getCommitFileDiff = vi.fn().mockResolvedValue(file('a.ts'));
    const copyText = vi.fn().mockResolvedValue(undefined);
    const notifyError = vi.fn();
    render(<GitChangesPanel workspaceRoot="/repo" reviewState={state} reviewError={null} reviewLoading={false} onRefresh={noop} actions={actions} />, {
      wrapper: host({ getHistory, getCommitDetails, getCommitFileDiff }, { copyText, notifyError }),
    });
    const first = await screen.findByRole('button', { name: /Commit aaaaaaaa/ });
    fireEvent.click(first);
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledOnce());
    getCommitDetails.mockClear();
    getCommitFileDiff.mockClear();
    const target = screen.getByRole('button', { name: /Commit bbbbbbbb/ });
    fireEvent.contextMenu(target);
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['打开更改', '复制提交 ID', '复制提交消息']);
    fireEvent.click(screen.getByRole('menuitem', { name: '复制提交 ID' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledExactlyOnceWith(two));
    expect(getCommitDetails).not.toHaveBeenCalled();

    fireEvent.contextMenu(target);
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制提交消息' }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(message));
    expect(getCommitDetails).toHaveBeenCalledExactlyOnceWith('/repo', two);
    expect(getCommitFileDiff).not.toHaveBeenCalled();
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(target.getAttribute('aria-pressed')).toBe('false');

    fireEvent.contextMenu(target);
    fireEvent.click(await screen.findByRole('menuitem', { name: '打开更改' }));
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledWith('/repo', { oid: two, filePath: 'a.ts', previousPath: undefined }));
    expect(target.getAttribute('aria-pressed')).toBe('true');
    expect(notifyError).not.toHaveBeenCalled();

    copyText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    fireEvent.contextMenu(target);
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制提交 ID' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('复制失败：Clipboard unavailable'));
  });

  it('loads a hover card only after a pause and keeps its actions separate from diff selection and the context menu', async () => {
    const pending = deferred<DesktopGitCommitDetails>();
    const getCommitDetails = vi.fn().mockReturnValue(pending.promise);
    const copyText = vi.fn().mockResolvedValue(undefined);
    const openExternal = vi.fn().mockResolvedValue(true);
    const onSelect = vi.fn();
    const message = 'Commit aaaaaaaa\n\nFull commit body with details.';
    const githubUrl = 'https://github.com/example/project/commit/' + one;
    render(<GitHistoryGraph workspaceRoot="/repo" commits={[commit(one)]} refs={[]} head={one} selectedOid={null}
      loading={false} hasMore={false} error={null} onSelect={onSelect} onSelectRef={noop} onLoadMore={noop} onRetry={noop}
    />, { wrapper: host({ getCommitDetails }, { copyText, openExternal }) });
    const row = screen.getByRole('listitem');
    fireEvent.pointerEnter(row);
    fireEvent.pointerLeave(row);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(getCommitDetails).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '提交详情' })).toBeNull();

    fireEvent.pointerEnter(row);
    await waitFor(() => expect(getCommitDetails).toHaveBeenCalledExactlyOnceWith('/repo', one));
    const card = await screen.findByRole('region', { name: '提交详情' });
    expect(within(card).getByRole('status').textContent).toBe('正在加载…');
    await act(async () => { pending.resolve({
      commit: commit(one), message, githubUrl, baseOid: null,
      files: [file('a.ts'), { ...file('b.ts'), additions: 1209, deletions: 536 }],
    }); });
    expect(within(card).getByText(/Full commit body/).textContent).toBe(message);
    expect(within(card).getByText('Author')).toBeTruthy();
    expect(card.querySelector('time')?.getAttribute('datetime')).toBe(commit(one).authoredAt);
    expect(within(card).getByText('已更改 2 个文件')).toBeTruthy();
    expect(within(card).getByText('1,210 行插入 (+)')).toBeTruthy();
    expect(within(card).getByText('537 行删除 (-)')).toBeTruthy();

    fireEvent.pointerLeave(row);
    fireEvent.pointerEnter(card.closest('.git-commit-hover')!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(screen.getByRole('region', { name: '提交详情' })).toBe(card);
    fireEvent.click(within(card).getByRole('button', { name: '复制提交 ID' }));
    expect(copyText).toHaveBeenCalledExactlyOnceWith(one);
    fireEvent.click(within(card).getByRole('button', { name: '在 GitHub 上打开' }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(githubUrl);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.contextMenu(row);
    expect(await screen.findByRole('menuitem', { name: '打开更改' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region', { name: '提交详情' })).toBeNull(), { timeout: 2000 });
    expect(getCommitDetails).toHaveBeenCalledOnce();
  });

  it('discards late file responses when the selected file or project changes', async () => {
    const oldFile = deferred<DesktopDiffFile>();
    const oldProject = deferred<DesktopDiffFile>();
    const getCommitFileDiff = vi.fn()
      .mockReturnValueOnce(oldFile.promise)
      .mockResolvedValueOnce(file('b.ts', 'selected file'))
      .mockReturnValueOnce(oldProject.promise)
      .mockResolvedValueOnce(file('b.ts', 'new project'));
    const hook = renderHook(({ root, path }) => useGitCommitFile(root, one, file(path)), {
      initialProps: { root: '/repo', path: 'a.ts' }, wrapper: host({ getCommitFileDiff }),
    });
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledTimes(1));
    hook.rerender({ root: '/repo', path: 'b.ts' });
    await waitFor(() => expect(hook.result.current.data?.patch).toBe('selected file'));
    await act(async () => { oldFile.resolve(file('a.ts', 'stale file')); });
    expect(hook.result.current.data?.patch).toBe('selected file');
    hook.rerender({ root: '/slow-project', path: 'b.ts' });
    await waitFor(() => expect(getCommitFileDiff).toHaveBeenCalledTimes(3));
    hook.rerender({ root: '/new-project', path: 'b.ts' });
    expect(hook.result.current.data).toBeNull();
    await waitFor(() => expect(hook.result.current.data?.patch).toBe('new project'));
    await act(async () => { oldProject.resolve(file('b.ts', 'stale project')); });
    expect(hook.result.current.data?.patch).toBe('new project');
  });

  it('preserves loaded pages on worktree refresh and ignores pagination from a previous branch', async () => {
    const pendingPage = deferred<DesktopGitHistoryPage>();
    const firstPage = { ...page([commit(one)]), nextSkip: 1 };
    const getHistory = vi.fn().mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({ ...page([commit(two)]), nextSkip: 2 })
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(pendingPage.promise)
      .mockResolvedValueOnce({ ...page([commit(two)]), tip: two });
    const hook = renderHook(({ reviewState }) => useGitHistory('/repo', reviewState), {
      initialProps: { reviewState: state }, wrapper: host({ getHistory }),
    });
    await waitFor(() => expect(hook.result.current.page?.commits).toHaveLength(1));
    await act(async () => { await hook.result.current.loadMore(); });
    expect(getHistory).toHaveBeenLastCalledWith('/repo', { ref: one, skip: 1 });
    expect(hook.result.current.page?.commits).toHaveLength(2);
    hook.rerender({ reviewState: { ...state } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.page?.commits).toHaveLength(2);
    act(() => { void hook.result.current.loadMore(); });
    await waitFor(() => expect(getHistory).toHaveBeenCalledTimes(4));
    act(() => hook.result.current.selectRef('refs/heads/feature'));
    await waitFor(() => expect(hook.result.current.page?.tip).toBe(two));
    await act(async () => { pendingPage.resolve(page([commit('c'.repeat(40))])); });
    expect(hook.result.current.page?.commits.map((entry) => entry.oid)).toEqual([two]);
  });

  it('keeps graph connections continuous through branching, merging and pagination', () => {
    const commits = [commit('merge', ['left', 'right']), commit('left', ['base']), commit('right', ['base']), commit('base')];
    const rows = layoutGitHistory(commits);
    expect(rows[0].edges.filter((edge) => edge.end === GIT_GRAPH_ROW_HEIGHT)).toHaveLength(2);
    for (let index = 1; index < rows.length; index += 1) {
      const above = rows[index - 1].edges.filter((edge) => edge.end === GIT_GRAPH_ROW_HEIGHT).map((edge) => edge.to + ':' + edge.color);
      const below = rows[index].edges.filter((edge) => edge.start === 0).map((edge) => edge.from + ':' + edge.color);
      expect([...new Set(above)].sort()).toEqual([...new Set(below)].sort());
    }
    expect(rows.at(-1)?.edges.every((edge) => edge.end < GIT_GRAPH_ROW_HEIGHT)).toBe(true);
    expect(layoutGitHistory(commits.slice(0, 2))).toEqual(rows.slice(0, 2));
  });

  it('renders visible nodes centered in each clickable row with distinct branch lanes', () => {
    const commits = [commit('head', ['merge']), commit('merge', ['left', 'right']), commit('left', ['right']), commit('right')];
    const view = render(<GitHistoryGraph
      workspaceRoot="/repo"
      commits={commits} refs={[]} head="head" selectedOid={null} loading={false} hasMore={false} error={null}
      onSelect={noop} onSelectRef={noop} onLoadMore={noop} onRetry={noop}
    />, { wrapper: host({}) });
    const nodes = [...view.container.querySelectorAll<HTMLElement>('.git-history-row')].map((row, index) => {
      const graph = row.querySelector('svg')!;
      const node = graph.querySelector('circle')!;
      const radius = Number(node.getAttribute('r'));
      const height = Number(graph.getAttribute('height'));
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeLessThan(height / 2);
      expect(Number(node.getAttribute('cy'))).toBe(height / 2);
      expect(parseFloat(row.style.height)).toBe(height);
      expect(parseFloat(row.style.top)).toBe(index * height);
      expect(node.getAttribute('fill')).toBeTruthy();
      return node;
    });
    expect(nodes[0].getAttribute('fill')).toBe('var(--git-nav-bg)');
    expect(nodes[1].getAttribute('fill')).toBe('var(--git-nav-bg)');
    expect(nodes[2].getAttribute('fill')).toBe(nodes[2].getAttribute('stroke'));
    expect(nodes[2].getAttribute('stroke')).not.toBe(nodes[3].getAttribute('stroke'));
  });
});
