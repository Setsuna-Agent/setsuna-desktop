// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopReviewBridge, DesktopReviewState } from '../../../src/contracts/index.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopReviewState } from '../../../src/renderer/hooks/useDesktopReviewState.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

let installedReviewBridge: DesktopReviewBridge | null = null;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  installedReviewBridge = null;
  vi.restoreAllMocks();
});

describe('useDesktopReviewState', () => {
  it('refreshes a closed review surface after workspace changes while preserving the preferred base ref', async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce(reviewState(1))
      .mockResolvedValueOnce(reviewState(2));
    let notifyWorkspaceChange: (() => void) | null = null;
    const stopWatching = vi.fn();
    installReviewBridge({
      getState,
      watchChanges: (_workspaceRoot, callback) => {
        notifyWorkspaceChange = callback;
        return stopWatching;
      },
    });
    window.localStorage.setItem('setsuna-desktop:review-base-ref:project-review', 'origin/master');

    const view = render(<ReviewStateProbe project={project} />);

    await waitFor(() => expect(getState).toHaveBeenCalledWith(project.path, {
      baseRef: 'origin/master',
      includeBranchSummary: false,
    }));
    expect(screen.getByTestId('additions').textContent).toBe('1');

    act(() => notifyWorkspaceChange?.());

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(getState).toHaveBeenLastCalledWith(project.path, {
      baseRef: 'origin/master',
      includeBranchSummary: false,
    });
    await waitFor(() => expect(screen.getByTestId('additions').textContent).toBe('2'));

    view.unmount();
    expect(stopWatching).toHaveBeenCalledOnce();
  });

  it('coalesces a workspace change received during a review load into one follow-up refresh', async () => {
    const pendingLoad = deferred<DesktopReviewState>();
    const getState = vi.fn()
      .mockResolvedValueOnce(reviewState(1))
      .mockReturnValueOnce(pendingLoad.promise)
      .mockResolvedValueOnce(reviewState(3));
    let notifyWorkspaceChange: (() => void) | null = null;
    installReviewBridge({
      getState,
      watchChanges: (_workspaceRoot, callback) => {
        notifyWorkspaceChange = callback;
        return () => undefined;
      },
    });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(1));

    act(() => notifyWorkspaceChange?.());
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('loading').textContent).toBe('false');
    act(() => {
      notifyWorkspaceChange?.();
      notifyWorkspaceChange?.();
    });
    pendingLoad.resolve(reviewState(2));

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByTestId('additions').textContent).toBe('3'));
  });

  it('normalizes a stored local base ref to the matching remote before keeping it', async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce({ ...reviewState(1), baseRef: 'master' })
      .mockResolvedValueOnce(reviewState(1));
    installReviewBridge({ getState, watchChanges: () => () => undefined });
    window.localStorage.setItem('setsuna-desktop:review-base-ref:project-review', 'master');

    render(<ReviewStateProbe project={project} />);

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(getState).toHaveBeenNthCalledWith(1, project.path, {
      baseRef: 'master',
      includeBranchSummary: false,
    });
    expect(getState).toHaveBeenNthCalledWith(2, project.path, {
      baseRef: 'origin/master',
      includeBranchSummary: false,
    });
    expect(window.localStorage.getItem('setsuna-desktop:review-base-ref:project-review')).toBe('origin/master');
  });

  it('keeps refresh separate from selecting and persisting a base ref', async () => {
    const getState = vi.fn().mockResolvedValue(reviewState(1));
    installReviewBridge({ getState, watchChanges: () => () => undefined });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'refresh review' }));
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(getState).toHaveBeenLastCalledWith(project.path, {
      baseRef: null,
      includeBranchSummary: false,
    });
    expect(window.localStorage.getItem('setsuna-desktop:review-base-ref:project-review')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'select base ref' }));
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(3));
    expect(getState).toHaveBeenLastCalledWith(project.path, {
      baseRef: 'origin/master',
      includeBranchSummary: true,
    });
    expect(window.localStorage.getItem('setsuna-desktop:review-base-ref:project-review')).toBe('origin/master');
  });

  it('preserves an explicitly selected local base ref when a remote counterpart exists', async () => {
    const localBaseState = {
      ...reviewState(1),
      baseRef: 'master',
      baseRefs: ['origin/master', 'master'],
    };
    const getState = vi.fn()
      .mockResolvedValueOnce(reviewState(1))
      .mockResolvedValueOnce(localBaseState);
    installReviewBridge({ getState, watchChanges: () => () => undefined });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(getState).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'select local base ref' }));

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(getState).toHaveBeenLastCalledWith(project.path, {
      baseRef: 'master',
      includeBranchSummary: true,
    });
    expect(window.localStorage.getItem('setsuna-desktop:review-base-ref:project-review')).toBe('master');
  });

  it('keeps the last successful snapshot when a background refresh fails', async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce(reviewState(4))
      .mockRejectedValueOnce(new Error('refresh failed'));
    let notifyWorkspaceChange: (() => void) | null = null;
    installReviewBridge({
      getState,
      watchChanges: (_workspaceRoot, callback) => {
        notifyWorkspaceChange = callback;
        return () => undefined;
      },
    });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(screen.getByTestId('additions').textContent).toBe('4'));

    act(() => notifyWorkspaceChange?.());

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('refresh failed'));
    expect(screen.getByTestId('additions').textContent).toBe('4');
  });

  it('loads branch details on demand and releases them after leaving the branch source', async () => {
    const withoutBranch = {
      ...reviewState(0),
      branchSummary: null,
      currentRemoteSummary: null,
    };
    const getState = vi.fn()
      .mockResolvedValueOnce(withoutBranch)
      .mockResolvedValueOnce(reviewState(7));
    installReviewBridge({ getState, watchChanges: () => () => undefined });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(getState).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'show branch' }));
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(getState).toHaveBeenLastCalledWith(project.path, {
      baseRef: null,
      includeBranchSummary: true,
    });
    await waitFor(() => expect(screen.getByTestId('additions').textContent).toBe('7'));

    fireEvent.click(screen.getByRole('button', { name: 'show unstaged' }));
    expect(screen.getByTestId('additions').textContent).toBe('0');
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('surfaces a foreground refresh failure instead of silently retaining stale data', async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce(reviewState(4))
      .mockRejectedValueOnce(new Error('manual refresh failed'));
    installReviewBridge({ getState, watchChanges: () => () => undefined });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(screen.getByTestId('additions').textContent).toBe('4'));

    fireEvent.click(screen.getByRole('button', { name: 'refresh review' }));

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('manual refresh failed'));
    expect(screen.getByTestId('additions').textContent).toBe('0');
  });

  it('re-subscribes after a refresh discovers that the workspace became a Git repository', async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce(nonGitReviewState())
      .mockResolvedValueOnce(reviewState(1));
    const disposers: ReturnType<typeof vi.fn>[] = [];
    const watchChanges = vi.fn(() => {
      const dispose = vi.fn();
      disposers.push(dispose);
      return dispose;
    });
    installReviewBridge({ getState, watchChanges });

    render(<ReviewStateProbe project={project} />);
    await waitFor(() => expect(watchChanges).toHaveBeenCalledTimes(2));
    expect(disposers[0]).toHaveBeenCalledOnce();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(watchChanges).toHaveBeenCalledTimes(3));
    expect(disposers[1]).toHaveBeenCalledOnce();
  });
});

function ReviewStateProbe({ project: activeProject }: { project: WorkspaceProject }) {
  return (
    <ReviewRendererTestHost bridge={installedReviewBridge}>
      <ReviewStateProbeContent project={activeProject} />
    </ReviewRendererTestHost>
  );
}

function ReviewStateProbeContent({ project: activeProject }: { project: WorkspaceProject }) {
  const review = useDesktopReviewState({ activeProject });
  return (
    <>
      <span data-testid="additions">{review.reviewState?.branchSummary?.additions ?? 0}</span>
      <span data-testid="error">{review.reviewError}</span>
      <span data-testid="loading">{String(review.reviewLoading)}</span>
      <button type="button" onClick={() => void review.loadReviewState()}>refresh review</button>
      <button type="button" onClick={() => void review.selectReviewBaseRef('origin/master')}>select base ref</button>
      <button type="button" onClick={() => void review.selectReviewBaseRef('master')}>select local base ref</button>
      <button type="button" onClick={() => review.setReviewSource('branch')}>show branch</button>
      <button type="button" onClick={() => review.setReviewSource('unstaged')}>show unstaged</button>
    </>
  );
}

function installReviewBridge({
  getState,
  watchChanges,
}: {
  getState: (workspaceRoot: string, options?: {
    baseRef?: string | null;
    includeBranchSummary?: boolean;
  }) => Promise<DesktopReviewState>;
  watchChanges: (workspaceRoot: string, callback: () => void) => () => void;
}): void {
  installedReviewBridge = { getState, watchChanges } as DesktopReviewBridge;
}

function reviewState(additions: number): DesktopReviewState {
  return {
    isGitRepository: true,
    workspaceRoot: project.path!,
    gitRoot: project.path!,
    currentBranch: 'feature/review',
    currentRemoteRef: 'origin/feature/review',
    baseRef: 'origin/master',
    baseRefs: ['origin/master', 'origin/feature/review'],
    branches: [{ name: 'feature/review', current: true, remote: false, uncommittedFiles: 0 }],
    currentRemoteSummary: null,
    branchSummary: { additions, deletions: 0, files: [] },
    stagedSummary: { additions: 0, deletions: 0, files: [] },
    unstagedSummary: { additions: 0, deletions: 0, files: [] },
  };
}

function nonGitReviewState(): DesktopReviewState {
  return {
    ...reviewState(0),
    isGitRepository: false,
    gitRoot: null,
    currentBranch: null,
    currentRemoteRef: null,
    baseRef: null,
    baseRefs: [],
    branches: [],
    branchSummary: null,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const project: WorkspaceProject = {
  id: 'project-review',
  name: 'Review fixture',
  path: '/tmp/review-fixture',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};
