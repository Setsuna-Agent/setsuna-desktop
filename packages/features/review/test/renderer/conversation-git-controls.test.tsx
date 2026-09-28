// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopReviewBridge, DesktopReviewState } from '../../src/contracts/index.js';
import { ConversationGitControls } from '../../src/renderer/ConversationGitControls.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(cleanup);

const state: DesktopReviewState = {
  workspaceRoot: '/repo', gitRoot: '/repo', isGitRepository: true, currentBranch: 'main',
  currentRemoteRef: null, baseRef: null, baseRefs: [], currentRemoteSummary: null,
  branchSummary: null, stagedSummary: null, unstagedSummary: null,
  branches: ['main', 'feature/search', 'fix/login'].map((name) => ({
    name, current: name === 'main', remote: false, uncommittedFiles: 0,
  })),
};

function surface(checkoutBranch: DesktopReviewBridge['checkoutBranch'], onRefresh: () => void, root = '/repo') {
  return <ReviewRendererTestHost bridge={{ checkoutBranch } as DesktopReviewBridge}>
    <ConversationGitControls variant="compact"
      activeProject={{ id: root, name: 'Project', path: root, createdAt: '', updatedAt: '' }}
      reviewState={{ ...state, workspaceRoot: root, gitRoot: root }} reviewError={null}
      reviewLoading={false} onReviewRefresh={onRefresh}
    />
  </ReviewRendererTestHost>;
}

it('searches branches and checks out the chosen branch, preserving Git errors for a retry', async () => {
  const checkout = vi.fn().mockRejectedValueOnce(new Error('Your local changes would be overwritten by checkout'))
    .mockResolvedValueOnce({ ...state, currentBranch: 'feature/search' });
  const refresh = vi.fn();
  render(surface(checkout, refresh));
  fireEvent.click(screen.getByRole('button', { name: '分支: main' }));
  fireEvent.change(await screen.findByRole('textbox', { name: '搜索分支' }), { target: { value: 'SEARCH' } });
  expect(screen.queryByRole('button', { name: 'fix/login' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'feature/search' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Your local changes would be overwritten');
  expect(checkout).toHaveBeenCalledExactlyOnceWith('/repo', 'feature/search');
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'feature/search' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.queryByRole('textbox', { name: '搜索分支' })).toBeNull();
});

it('does not refresh the previous repository when checkout finishes after a project switch', async () => {
  let finish!: (value: DesktopReviewState) => void;
  const checkout = vi.fn(() => new Promise<DesktopReviewState>((resolve) => { finish = resolve; }));
  const refreshOld = vi.fn();
  const refreshNew = vi.fn();
  const view = render(surface(checkout, refreshOld));
  fireEvent.click(screen.getByRole('button', { name: '分支: main' }));
  fireEvent.click(await screen.findByRole('button', { name: 'fix/login' }));
  view.rerender(surface(checkout, refreshNew, '/other'));
  await act(async () => finish(state));
  expect(refreshOld).not.toHaveBeenCalled();
  expect(refreshNew).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '分支: main' }));
  fireEvent.click(await screen.findByRole('button', { name: 'feature/search' }));
  expect(checkout).toHaveBeenLastCalledWith('/other', 'feature/search');
  await act(async () => finish(state));
  expect(refreshNew).toHaveBeenCalledOnce();
});

it('allows creation with working changes and requests auto-staging through the native branch operation', async () => {
  const createBranch = vi.fn().mockResolvedValue({ ...state, currentBranch: 'feature/new' });
  const refresh = vi.fn();
  render(<ReviewRendererTestHost bridge={{ createBranch } as unknown as DesktopReviewBridge}>
    <ConversationGitControls variant="compact"
      activeProject={{ id: 'repo', name: 'Project', path: '/repo', createdAt: '', updatedAt: '' }}
      reviewState={{ ...state, unstagedSummary: { additions: 1, deletions: 0, files: [
        { path: 'tracked.txt', action: 'Modified', additions: 1, deletions: 0, truncated: false, lines: [] },
      ] } }}
      reviewLoading={false} reviewError={null} onReviewRefresh={refresh}
    />
  </ReviewRendererTestHost>);
  fireEvent.click(screen.getByRole('button', { name: '分支: main' }));
  fireEvent.click(await screen.findByRole('button', { name: '创建并检出新分支' }));
  fireEvent.change(screen.getByPlaceholderText('新分支名称'), { target: { value: ' feature/new ' } });
  fireEvent.click(screen.getByRole('button', { name: '创建分支' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(createBranch).toHaveBeenCalledExactlyOnceWith('/repo', 'feature/new', { stageUnstaged: true });
});
