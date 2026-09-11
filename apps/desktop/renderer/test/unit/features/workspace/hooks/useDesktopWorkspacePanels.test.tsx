// @vitest-environment happy-dom

import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { DesktopReviewBridge, DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer';
import { WorkspaceGitCommitProvider, useWorkspaceGitCommitDialog } from '@setsuna-desktop/feature-review/renderer/git';
import { DESKTOP_WORKSPACE_APP_STORAGE_KEY } from '@setsuna-desktop/feature-workspace-apps/renderer';
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
  localStorage.removeItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY);
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

it('opens the selected app at the current conversation workspace and remembers the choice', async () => {
  const workspace = { id: 'worktree-a', path: '/repo/.worktrees/a', name: 'Repository', createdAt: '', updatedAt: '' };
  const apps = [{ id: 'vscode', label: 'VS Code', icon: 'vscode' }, { id: 'cursor', label: 'Cursor', icon: 'cursor' }];
  const open = vi.fn().mockResolvedValue(true);
  const list = vi.fn().mockResolvedValue(apps);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { desktop: { platform: 'win32' }, workspaceApps: { list, open } },
  });
  const view = renderHook(({ activeProject }) => useDesktopWorkspacePanels({
    activeProject, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: `new-thread-slot:${activeProject.id}`, workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    initialProps: { activeProject: workspace },
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  await waitFor(() => expect(view.result.current.workspaceApps).toHaveLength(2));
  await act(async () => view.result.current.openWorkspaceInApp('cursor'));
  expect(open).toHaveBeenCalledExactlyOnceWith(workspace.path, 'cursor', null, null);
  expect(view.result.current.selectedWorkspaceApp?.id).toBe('cursor');
  expect(localStorage.getItem(DESKTOP_WORKSPACE_APP_STORAGE_KEY)).toBe('cursor');

  view.rerender({ activeProject: { ...workspace, id: 'worktree-b', path: '/repo/.worktrees/b' } });
  await waitFor(() => expect(list).toHaveBeenLastCalledWith('/repo/.worktrees/b'));
  await act(async () => view.result.current.openWorkspaceInApp('vscode'));
  expect(open).toHaveBeenLastCalledWith('/repo/.worktrees/b', 'vscode', null, null);
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

it('closes only the visible active side tab, leaving bottom and collapsed tabs intact', () => {
  const view = renderHook(({ activeView }) => useDesktopWorkspacePanels({
    activeProject: null, activeView, conversationDebugEnabled: false,
    targetIdentity: 'new-thread-slot:global', workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    initialProps: { activeView: 'chat' },
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });

  act(() => view.result.current.openDesktopPanel('side', 'chat'));
  const firstTabId = view.result.current.sideActivePanel!.id;
  act(() => view.result.current.openDesktopPanel('side', 'chat'));
  const secondTabId = view.result.current.sideActivePanel!.id;
  act(() => view.result.current.openDesktopPanel('bottom', 'chat'));
  const bottomTabs = view.result.current.bottomPanelSlot;

  act(() => view.result.current.closeActiveSidePanel());
  expect(view.result.current.sidePanelSlot.panels.map((panel) => panel.id)).not.toContain(secondTabId);
  expect(view.result.current.sideActivePanel?.id).toBe(firstTabId);
  expect(view.result.current.bottomPanelSlot).toEqual(bottomTabs);

  act(() => view.result.current.toggleSidePanel());
  act(() => view.result.current.closeActiveSidePanel());
  expect(view.result.current.sideActivePanel?.id).toBe(firstTabId);
  act(() => view.result.current.toggleSidePanel());

  view.rerender({ activeView: 'settings' });
  act(() => view.result.current.closeActiveSidePanel());
  expect(view.result.current.sideActivePanel?.id).toBe(firstTabId);
  view.rerender({ activeView: 'chat' });

  act(() => view.result.current.closeActiveSidePanel());
  expect(view.result.current.sideActivePanel).toBeNull();
  act(() => view.result.current.closeActiveSidePanel());
  expect(view.result.current.bottomPanelSlot).toEqual(bottomTabs);
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
