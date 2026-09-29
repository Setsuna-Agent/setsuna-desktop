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
import type { ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import type { DesktopTerminalEvent } from '../../../../../src/features/workspace/model.js';
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

it('hides and restores all bottom tabs and terminal sessions without closing them, scoped to the conversation', async () => {
  const project = { id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '' };
  let sequence = 0;
  const open = vi.fn(async () => ({ sessionId: `session-${++sequence}`, workspaceRoot: project.path, shell: '/bin/zsh', cols: 100, rows: 24 }));
  const close = vi.fn(async () => true);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      terminal: { open, close, read: vi.fn().mockResolvedValue([]), onEvent: vi.fn(() => () => undefined) },
      workspaceApps: { list: vi.fn().mockResolvedValue([]) },
    },
  });
  const view = renderHook(({ targetIdentity }) => useDesktopWorkspacePanels({
    activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity, workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    initialProps: { targetIdentity: 'thread:A' as ChatComposerTargetIdentity },
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });

  act(() => view.result.current.toggleBottomPanel());
  await waitFor(() => expect(Object.keys(view.result.current.terminalSessionsByPanelId)).toHaveLength(1));
  act(() => view.result.current.openDesktopPanel('bottom', 'terminal'));
  await waitFor(() => expect(Object.keys(view.result.current.terminalSessionsByPanelId)).toHaveLength(2));
  const tabs = view.result.current.bottomPanelSlot;
  const sessions = view.result.current.terminalSessionsByPanelId;
  expect(view.result.current.bottomPanelVisible).toBe(true);

  act(() => view.result.current.hideBottomPanel());
  expect(view.result.current.bottomPanelVisible).toBe(false);
  expect(view.result.current.bottomPanelSlot).toEqual(tabs);
  expect(view.result.current.terminalSessionsByPanelId).toEqual(sessions);
  view.rerender({ targetIdentity: 'thread:B' });
  act(() => view.result.current.openDesktopPanel('bottom', 'chat'));
  expect(view.result.current.bottomPanelVisible).toBe(true);
  view.rerender({ targetIdentity: 'thread:A' });
  expect(view.result.current.bottomPanelVisible).toBe(false);

  act(() => view.result.current.toggleBottomPanel());
  expect(view.result.current.bottomPanelVisible).toBe(true);
  expect(view.result.current.bottomPanelSlot).toEqual(tabs);
  expect(view.result.current.terminalSessionsByPanelId).toEqual(sessions);
  act(() => view.result.current.toggleBottomPanel());
  expect(view.result.current.bottomPanelVisible).toBe(false);
  expect(close).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(2);

  act(() => view.result.current.closeDesktopPanelItem('bottom', tabs.active!));
  expect(close).toHaveBeenCalledExactlyOnceWith(sessions[tabs.active!].sessionId);
  expect(view.result.current.bottomPanelSlot.panels).toHaveLength(1);
  expect(view.result.current.bottomPanelVisible).toBe(false);
});

it.each(['side', 'bottom'] as const)('closes the exited shell tab in the %s slot and collapses only when the last tab exits', async (slot) => {
  const { view, terminal, emit } = renderTerminalWorkspace();
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  const visibleKey = slot === 'side' ? 'sidePanelVisible' : 'bottomPanelVisible';
  const openTab = async () => {
    act(() => view.result.current.openDesktopPanel(slot, 'terminal'));
    const panelId = view.result.current[slotKey].active!;
    await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]).toBeDefined());
    return { panelId, sessionId: view.result.current.terminalSessionsByPanelId[panelId].sessionId };
  };
  const first = await openTab();
  const second = await openTab();
  act(() => emit(first.sessionId, { seq: 1, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current[slotKey].panels.map((panel) => panel.id)).toEqual([second.panelId]);
  expect(view.result.current[slotKey].active).toBe(second.panelId);
  expect(view.result.current[visibleKey]).toBe(true);
  expect(terminal.close).toHaveBeenCalledExactlyOnceWith(first.sessionId);

  const third = await openTab();
  act(() => emit(third.sessionId, { seq: 1, event: 'exit', data: { exitCode: 1 } }));
  expect(view.result.current[slotKey].active).toBe(second.panelId);
  expect(view.result.current[visibleKey]).toBe(true);
  act(() => emit(second.sessionId, { seq: 1, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current[slotKey]).toEqual({ active: null, panels: [] });
  expect(view.result.current[visibleKey]).toBe(false);
  expect(view.result.current.terminalSessionsByPanelId).toEqual({});
  expect(terminal.close).toHaveBeenCalledTimes(3);
  expect(terminal.open).toHaveBeenCalledTimes(3);
});

it('closes a hidden terminal in its claimed conversation without changing the current conversation', async () => {
  const { view, terminal, emit } = renderTerminalWorkspace('new-thread-slot:project');
  act(() => view.result.current.toggleBottomPanel());
  const panelId = view.result.current.bottomPanelSlot.active!;
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]).toBeDefined());
  const { sessionId } = view.result.current.terminalSessionsByPanelId[panelId];
  act(() => view.result.current.claimForThread('A'));
  view.rerender({ targetIdentity: 'thread:A' });
  act(() => view.result.current.hideBottomPanel());
  view.rerender({ targetIdentity: 'thread:B' });
  act(() => view.result.current.openDesktopPanel('bottom', 'chat'));
  const currentTabs = view.result.current.bottomPanelSlot;

  act(() => emit(sessionId, { seq: 2, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current.bottomPanelSlot).toBe(currentTabs);
  expect(view.result.current.bottomPanelVisible).toBe(true);
  expect(terminal.close).toHaveBeenCalledExactlyOnceWith(sessionId);
  view.rerender({ targetIdentity: 'thread:A' });
  expect(view.result.current.bottomPanelSlot).toEqual({ active: null, panels: [] });
  expect(view.result.current.bottomPanelExpanded).toBe(false);
  expect(view.result.current.terminalSessionsByPanelId[panelId]).toBeUndefined();
  expect(terminal.open).toHaveBeenCalledTimes(1);
});

it('restores a hidden non-terminal tab and reveals it only for an explicit navigation action', () => {
  const view = renderHook(() => useDesktopWorkspacePanels({
    activeProject: null, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: 'new-thread-slot:global', workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  act(() => view.result.current.openBrowserPanel('https://example.com', 'bottom'));
  const tab = view.result.current.bottomActivePanel!;
  act(() => view.result.current.hideBottomPanel());
  act(() => view.result.current.updateDesktopPanel(tab.id, { title: 'Updated in background' }));
  expect(view.result.current.bottomPanelVisible).toBe(false);
  expect(view.result.current.browserPanelInstances[0]?.active).toBe(false);
  act(() => view.result.current.toggleBottomPanel());
  expect(view.result.current.bottomActivePanel?.id).toBe(tab.id);
  expect(view.result.current.bottomPanelSlot.panels).toHaveLength(1);
  expect(view.result.current.browserPanelInstances[0]?.active).toBe(true);
  act(() => view.result.current.hideBottomPanel());
  act(() => view.result.current.activateDesktopPanel('bottom', tab.id));
  expect(view.result.current.bottomPanelVisible).toBe(true);
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

function renderTerminalWorkspace(targetIdentity: ChatComposerTargetIdentity = 'thread:A') {
  const project = { id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '' };
  const listeners = new Map<string, Set<(event: DesktopTerminalEvent) => void>>();
  let sequence = 0;
  const terminal = {
    open: vi.fn(async () => ({ sessionId: `session-${++sequence}`, workspaceRoot: '/repo', shell: 'zsh', cols: 100, rows: 24 })),
    close: vi.fn(async () => true),
    read: vi.fn(async () => []),
    onEvent: vi.fn((sessionId: string, listener: (event: DesktopTerminalEvent) => void) => {
      const subscribers = listeners.get(sessionId) ?? new Set();
      listeners.set(sessionId, subscribers);
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    }),
  };
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { desktop: { platform: 'darwin' }, terminal, workspaceApps: { list: vi.fn().mockResolvedValue([]) } },
  });
  const view = renderHook(({ targetIdentity: identity }) => useDesktopWorkspacePanels({
    activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: identity, workspaceStatus: 'ready', setError: vi.fn(),
  }), {
    initialProps: { targetIdentity },
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  return { view, terminal, emit: (sessionId: string, event: DesktopTerminalEvent) => listeners.get(sessionId)?.forEach((listener) => listener(event)) };
}
