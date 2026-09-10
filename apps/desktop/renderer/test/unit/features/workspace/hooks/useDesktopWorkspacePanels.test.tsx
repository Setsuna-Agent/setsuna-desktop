// @vitest-environment happy-dom

import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { DesktopReviewBridge, DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer';
import { WorkspaceGitCommitProvider, useWorkspaceGitCommitDialog } from '@setsuna-desktop/feature-review/renderer/git';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../../../src/composition/review-feature-adapter.js';
import { useDesktopWorkspacePanels, useSidePanelTransition } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../../src/shared/i18n/messages.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }]);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it.each(['side', 'bottom'] as const)('cancels amend in the %s slot when resetting the same new-conversation layout', async (slot) => {
  const project = { id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '' };
  const state: DesktopReviewState = {
    isGitRepository: true, workspaceRoot: project.path, gitRoot: project.path, currentBranch: 'main',
    currentRemoteRef: null, baseRef: null, baseRefs: [], branches: [],
    currentRemoteSummary: null, branchSummary: null, stagedSummary: null, unstagedSummary: null,
  };
  const commit = vi.fn();
  const pull = vi.fn().mockResolvedValue({ ok: true, pulled: true, state });
  const bridge = {
    getState: vi.fn().mockResolvedValue(state),
    watchChanges: vi.fn(() => () => undefined),
    getCommitMessage: vi.fn().mockResolvedValue({ oid: 'a'.repeat(40), branch: 'main', message: 'Original message', context: 'On branch main' }),
    commit, pull,
  } satisfies Pick<DesktopReviewBridge, 'getState' | 'watchChanges' | 'getCommitMessage' | 'commit' | 'pull'>;
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { desktopReview: bridge, desktop: { platform: 'darwin' }, workspaceApps: { list: vi.fn().mockResolvedValue([]) } },
  });
  let panels!: ReturnType<typeof useDesktopWorkspacePanels>;
  const setError = vi.fn();
  function Workspace({ children }: PropsWithChildren) {
    panels = useDesktopWorkspacePanels({
      activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
      targetIdentity: 'new-thread-slot:project', workspaceStatus: 'ready', setError,
    });
    return <WorkspaceGitCommitProvider activeProject={project} reviewState={state} reviewLoading={false}
      onOpenMessageEditor={panels.openCommitMessageEditor}>{children}</WorkspaceGitCommitProvider>;
  }
  const view = renderHook(useWorkspaceGitCommitDialog, {
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary><Workspace>{children}</Workspace></ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  act(() => view.result.current.composer!.amend());
  await waitFor(() => expect(view.result.current.messageEditor).not.toBeNull());
  expect(view.result.current.composer?.busy).toBe(true);
  act(() => view.result.current.messageEditor!.setMessage('Unsubmitted amended message'));
  const tab = panels.sidePanelSlot.panels.find((panel) => panel.type === 'commit-message')!;
  if (slot === 'bottom') act(() => panels.moveDesktopPanel('side', tab.id, 'bottom', null, 'after'));

  act(() => panels.resetNewThreadPanelSession('another-project'));
  expect(view.result.current.messageEditor).not.toBeNull();
  expect(panels[slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot'].panels).toContainEqual(tab);
  act(() => panels.resetNewThreadPanelSession(project.id));
  await waitFor(() => expect(view.result.current.composer?.busy).toBe(false));
  expect(view.result.current.messageEditor).toBeNull();
  expect(panels.sidePanelSlot.panels).toEqual([]);
  expect(panels.bottomPanelSlot.panels).toEqual([]);
  expect(commit).not.toHaveBeenCalled();
  act(() => view.result.current.composer!.pull());
  await waitFor(() => expect(pull).toHaveBeenCalledExactlyOnceWith(project.path, {}));
  await waitFor(() => expect(view.result.current.composer?.busy).toBe(false));
  expect(setError).not.toHaveBeenCalled();
});

it('updates the shared panel launcher when Git repository detection changes', async () => {
  const project = { id: 'launcher-project', path: '/launcher-repo', name: 'Repository', createdAt: '', updatedAt: '' };
  const state: DesktopReviewState = {
    isGitRepository: true, workspaceRoot: project.path, gitRoot: project.path, currentBranch: 'main',
    currentRemoteRef: null, baseRef: null, baseRefs: [], branches: [],
    currentRemoteSummary: null, branchSummary: null, stagedSummary: null, unstagedSummary: null,
  };
  const getState = vi.fn().mockResolvedValue(state);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktopReview: { getState, watchChanges: vi.fn(() => () => undefined) },
      desktop: { platform: 'darwin' },
      workspaceApps: { list: vi.fn().mockResolvedValue([]) },
    },
  });
  const view = renderHook(() => useDesktopWorkspacePanels({
    activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: 'new-thread-slot:launcher-project', workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });

  expect(view.result.current.panelLauncherTypes).not.toContain('changes');
  await waitFor(() => expect(view.result.current.panelLauncherTypes).toContain('changes'));

  getState.mockResolvedValue({ ...state, isGitRepository: false, gitRoot: null, currentBranch: null });
  await act(async () => { await view.result.current.loadReviewState(); });
  expect(view.result.current.panelLauncherTypes).not.toContain('changes');
  expect(view.result.current.panelLauncherTypes).toEqual(expect.arrayContaining(['review', 'files', 'terminal']));

  getState.mockResolvedValue(state);
  await act(async () => { await view.result.current.loadReviewState(); });
  expect(view.result.current.panelLauncherTypes).toContain('changes');
});

describe('useSidePanelTransition', () => {
  it('keeps the panel mounted until a reversed closing transition settles', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ visible }) => useSidePanelTransition(visible),
      { initialProps: { visible: false } },
    );

    view.rerender({ visible: true });
    expect(view.result.current).toEqual({ phase: 'opening', present: true });

    act(() => vi.advanceTimersByTime(140));
    view.rerender({ visible: false });
    expect(view.result.current).toEqual({ phase: 'closing', present: true });

    act(() => vi.advanceTimersByTime(279));
    expect(view.result.current).toEqual({ phase: 'closing', present: true });

    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toEqual({ phase: null, present: false });
  });
});
