// @vitest-environment happy-dom

import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopReviewBridge, DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer';
import { WorkspaceGitCommitProvider, useWorkspaceGitCommitDialog } from '@setsuna-desktop/feature-review/renderer/git';
import { DESKTOP_WORKSPACE_APP_STORAGE_KEY } from '@setsuna-desktop/feature-workspace-apps/renderer';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { AppWorkspaceToolbar } from '../../../../../src/app/layout/AppWorkspaceToolbar.js';
import { ReviewFeatureHostBoundary } from '../../../../../src/composition/review-feature-adapter.js';
import { BottomToolsPanel } from '../../../../../src/features/workspace/BottomToolsPanel.js';
import { useDesktopWorkspacePanels, useSidePanelTransition } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import type { ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import type { DesktopTerminalEvent } from '../../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../../src/shared/i18n/messages.js';
import { writeSessionRecord } from '../../../../../src/shared/preferences/sessionStorage.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }]);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
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

it('opens navigation from the side add button and creates only terminals from the bottom add button', () => {
  let panels!: ReturnType<typeof useDesktopWorkspacePanels>;
  function Workspace() {
    panels = useDesktopWorkspacePanels({
      activeProject: null, activeView: 'chat', conversationDebugEnabled: false,
      targetIdentity: 'new-thread-slot:global', workspaceStatus: 'ready', setError: vi.fn(),
    });
    return <>
      <AppWorkspaceToolbar workspacePanels={panels} projectWorkspace={{} as ProjectWorkspaceState}
        workspaceMaximized={false} onToggleMaximized={vi.fn()} />
      {panels.bottomActivePanel ? <BottomToolsPanel
        activePanel={panels.bottomActivePanel} panels={panels.bottomPanelSlot.panels}
        onActivatePanel={(id) => panels.activateDesktopPanel('bottom', id)}
        onClosePanel={(id) => panels.closeDesktopPanelItem('bottom', id)}
        onHide={panels.hideBottomPanel} onMovePanel={vi.fn()} onReorderPanels={vi.fn()}
        onNewTerminal={() => panels.openDesktopPanel('bottom', 'terminal')}
        onResizeStep={vi.fn()} onResizeStart={vi.fn()} resizeMin={100} resizeMax={500} resizeValue={200}
      /> : null}
    </>;
  }
  render(<Workspace />, {
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  act(() => panels.openDesktopPanel('side', 'chat'));
  const sideChat = panels.sideActivePanel!;
  fireEvent.click(screen.getByRole('button', { name: '打开导航页' }));
  expect(panels.sideActivePanel?.type).toBe('overview');
  expect(panels.sidePanelSlot.panels).toContainEqual(sideChat);
  fireEvent.click(screen.getByRole('button', { name: '打开导航页' }));
  expect(panels.sidePanelSlot.panels.filter((panel) => panel.type === 'overview')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '侧边对话' }));
  expect(panels.sideActivePanel?.id).toBe(sideChat.id);

  act(() => panels.openDesktopPanel('bottom', 'chat'));
  const bottomChat = panels.bottomActivePanel!;
  fireEvent.click(screen.getByRole('button', { name: '新建终端' }));
  const firstTerminal = panels.bottomActivePanel!;
  expect(firstTerminal.type).toBe('terminal');
  fireEvent.click(screen.getByRole('button', { name: '新建终端' }));
  expect(panels.bottomActivePanel?.type).toBe('terminal');
  expect(panels.bottomActivePanel?.id).not.toBe(firstTerminal.id);
  expect(panels.bottomPanelSlot.panels).toEqual([bottomChat, firstTerminal, panels.bottomActivePanel]);
  expect(panels.sideActivePanel?.id).toBe(sideChat.id);
  expect(screen.queryByRole('menu')).toBeNull();
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
  act(() => view.result.current.openBrowserPanel('https://example.com', 'bottom', 'browser-issued-id'));
  const tab = view.result.current.bottomActivePanel!;
  expect(tab.id).toBe('browser-issued-id');
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

    act(() => vi.advanceTimersByTime(219));
    expect(view.result.current).toEqual({ phase: 'closing', present: true });

    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toEqual({ phase: null, present: false });
  });
});

it('reuses each directory shell and keeps the other shell alive when one exits', async () => {
  const { view, terminal, emit } = renderTerminalWorkspace('thread:A', {
    id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'child', path: '/agent' }],
  });
  act(() => view.result.current.openDesktopPanel('side', 'terminal'));
  const panelId = view.result.current.sidePanelSlot.active!;
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1'));
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: 'child' }));
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-2'));
  expect(terminal.open).toHaveBeenLastCalledWith('/agent', 100, 24);
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: 'main' }));
  expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1');
  act(() => emit('session-2', { seq: 1, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current.sidePanelSlot.panels).toHaveLength(1);
  expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1');
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: 'child' }));
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-3'));
  act(() => emit('session-3', { seq: 1, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current.sideActivePanel?.rootId).toBe('main');
  expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1');
  expect(terminal.open).toHaveBeenCalledTimes(3);
});

it.each([
  ['side', 'main', 'session-1', 'session-2'],
  ['bottom', 'child', 'session-2', 'session-1'],
] as const)('reuses the surviving directory when the selected %s terminal exits in a background chat', async (slot, exitedRoot, exitedSession, remainingSession) => {
  const project: WorkspaceProject = { id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'child', path: '/agent' }],
  };
  const { view, terminal, emit } = renderTerminalWorkspace('thread:A', project);
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  act(() => view.result.current.openDesktopPanel(slot, 'terminal'));
  const panelId = view.result.current[slotKey].active!;
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1'));
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: 'child' }));
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-2'));
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: exitedRoot }));
  view.rerender({ targetIdentity: 'thread:B', project: { ...project, id: 'other-project', path: '/other', roots: [{ id: 'main', path: '/other' }] } });
  act(() => view.result.current.openDesktopPanel(slot, 'chat'));
  const backgroundLayout = view.result.current[slotKey];
  act(() => emit(exitedSession, { seq: 1, event: 'exit', data: { exitCode: 0 } }));
  expect(view.result.current[slotKey]).toBe(backgroundLayout);
  expect(terminal.close).toHaveBeenCalledExactlyOnceWith(exitedSession);
  view.rerender({ targetIdentity: 'thread:A', project });
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe(remainingSession));
  expect(terminal.open).toHaveBeenCalledTimes(2);
});

it.each(['/repo', 'C:\\repo'])('passes root-relative paths to native file actions for %s', async (mainPath) => {
  const childPath = `${mainPath}-child`;
  const { view } = renderTerminalWorkspace('thread:A', {
    id: 'project', name: 'Repository', path: mainPath, createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: mainPath }, { id: 'child', path: childPath }],
  });
  const desktop = {
    copyWorkspaceFilePath: vi.fn().mockResolvedValue({ ok: true }),
    revealWorkspaceFile: vi.fn().mockResolvedValue({ ok: true }),
    openWorkspaceDirectory: vi.fn().mockResolvedValue({ ok: true }),
  };
  Object.assign(window.setsunaDesktop!.desktop, desktop);
  for (const root of [mainPath, childPath]) {
    await act(async () => {
      await view.result.current.copyWorkspaceFilePath(`${root}/src/same.ts`);
      await view.result.current.revealWorkspaceFile(`${root}/src/same.ts`);
      await view.result.current.openWorkspaceDirectory(`${root}/src`);
    });
    expect(desktop.copyWorkspaceFilePath).toHaveBeenLastCalledWith(root, 'src/same.ts');
    expect(desktop.revealWorkspaceFile).toHaveBeenLastCalledWith(root, 'src/same.ts');
    expect(desktop.openWorkspaceDirectory).toHaveBeenLastCalledWith(root, 'src');
  }
});

it.each([false, true])('closes removed-directory terminals, including hidden sessions (pending: %s)', async (pending) => {
  const project: WorkspaceProject = {
    id: 'project', name: 'Repository', path: '/repo', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'child', path: '/agent' }],
  };
  const { view, terminal } = renderTerminalWorkspace('thread:A', project);
  act(() => view.result.current.openDesktopPanel('side', 'terminal'));
  const panelId = view.result.current.sidePanelSlot.active!;
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1'));
  let resolvePending!: (session: Awaited<ReturnType<typeof terminal.open>>) => void;
  if (pending) terminal.open.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
  act(() => view.result.current.updateDesktopPanel(panelId, { rootId: 'child' }));
  await waitFor(() => expect(terminal.open).toHaveBeenCalledTimes(2));
  if (!pending) await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-2'));
  // Cached sessions in another conversation must also lose removed directory bindings.
  view.rerender({ targetIdentity: 'thread:B', project: { ...project, roots: project.roots!.slice(0, 1) } });
  if (pending) await act(async () => resolvePending({ sessionId: 'session-2', workspaceRoot: '/agent', shell: 'zsh', cols: 100, rows: 24 }));
  await waitFor(() => expect(terminal.close).toHaveBeenCalledExactlyOnceWith('session-2'));
  view.rerender({ targetIdentity: 'thread:A', project: { ...project, roots: project.roots!.slice(0, 1) } });
  await waitFor(() => expect(view.result.current.terminalSessionsByPanelId[panelId]?.sessionId).toBe('session-1'));
  expect(view.result.current.sideActivePanel?.rootId).toBe('main');
  expect(terminal.open).toHaveBeenCalledTimes(2);
  act(() => view.result.current.closeDesktopPanelItem('side', panelId));
  expect(terminal.close).toHaveBeenCalledTimes(2);
});

it.each(['/worktree/child', 'C:\\worktree\\child'])('restores a terminal at its selected workspace directory without reusing a process (%s)', async (path) => {
  const scope = 'primary:0';
  writeSessionRecord(scope, 'panels', 'thread:A', {
    bottomPanelExpanded: true,
    bottomPanelSlot: { active: 'saved-terminal', panels: [{ id: 'saved-terminal', type: 'terminal', rootId: 'child', sessionId: 'old-process' }] },
  });
  const project: WorkspaceProject = {
    id: 'project', name: 'Repository', path: '/repo', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'child', path }],
  };
  const { view, terminal } = renderTerminalWorkspace('thread:A', project, scope);
  await waitFor(() => expect(terminal.open).toHaveBeenCalledExactlyOnceWith(path, 100, 24));
  expect(view.result.current.terminalSessionsByPanelId['saved-terminal']?.sessionId).toBe('session-1');
  expect(view.result.current.bottomActivePanel?.rootId).toBe('child');
});

it('opens multiple PRs in their owning conversation and reactivates the same PR without duplicate tabs', () => {
  const savedFile = { id: 'file:README.md', type: 'file' as const, filePath: 'README.md' };
  writeSessionRecord('pr-window', 'panels', 'thread:B', {
    sidePanelExpanded: true, sidePanelSlot: { active: savedFile.id, panels: [savedFile] },
    bottomPanelExpanded: false, bottomPanelSlot: { active: null, panels: [] },
  });
  const { view } = renderTerminalWorkspace('thread:A', undefined, 'pr-window');
  const openForThread = view.result.current.openPullRequestPanel;
  act(() => {
    openForThread('B', { repository: 'Owner/Repo', number: 12 });
    openForThread('B', { repository: 'owner/repo', number: 13 });
    openForThread('B', { repository: 'other/repo', number: 12 });
  });
  expect(view.result.current.sidePanelSlot.panels).toEqual([]);
  view.rerender({ targetIdentity: 'thread:B' });
  expect(view.result.current.sidePanelSlot.panels.map((panel) => panel.id)).toEqual([
    savedFile.id, 'pull-request:owner/repo#12', 'pull-request:owner/repo#13', 'pull-request:other/repo#12',
  ]);
  expect(view.result.current.sidePanelVisible).toBe(true);
  act(() => view.result.current.moveDesktopPanel('side', 'pull-request:owner/repo#12', 'bottom', null, 'after'));
  act(() => openForThread('B', { repository: 'owner/repo', number: 12 }));
  expect(view.result.current.sidePanelSlot.active).toBe('pull-request:owner/repo#12');
  expect(view.result.current.sidePanelSlot.panels).toHaveLength(4);
  expect(view.result.current.bottomPanelSlot.panels).toEqual([]);
  view.rerender({ targetIdentity: 'thread:A' });
  expect(view.result.current.sidePanelSlot.panels).toEqual([]);
});

it('runs an action in a new bottom terminal at the current worktree and never replays it on conversation recovery', async () => {
  const project: WorkspaceProject = { id: 'project', name: 'Repository', path: '/worktree/branch', createdAt: '', updatedAt: '' };
  const { view, terminal } = renderTerminalWorkspace('thread:A', project, 'action-window');
  act(() => view.result.current.openDesktopPanel('bottom', 'terminal'));
  await waitFor(() => expect(terminal.open).toHaveBeenCalledTimes(1));
  const originalId = view.result.current.bottomActivePanel!.id;
  const command = { name: 'Server', command: 'export PORT=4000\npnpm dev' };
  await act(async () => { await view.result.current.runTerminalAction(command); });
  expect(terminal.open).toHaveBeenLastCalledWith(project.path, 100, 24, command);
  expect(view.result.current.bottomPanelSlot.panels).toHaveLength(2);
  expect(view.result.current.bottomActivePanel?.id).not.toBe(originalId);
  expect(view.result.current.bottomPanelVisible).toBe(true);
  act(() => view.result.current.hideBottomPanel());
  view.rerender({ targetIdentity: 'thread:B' });
  view.rerender({ targetIdentity: 'thread:A' });
  act(() => view.result.current.toggleBottomPanel());
  expect(terminal.open).toHaveBeenCalledTimes(2);
  view.unmount();
  const restored = renderTerminalWorkspace('thread:A', project, 'action-window');
  await waitFor(() => expect(restored.terminal.open).toHaveBeenCalledExactlyOnceWith(project.path, 100, 24));
});

it('releases a late action session after its tab closes instead of running it in another conversation', async () => {
  const { view, terminal } = renderTerminalWorkspace();
  let resolve!: (session: Awaited<ReturnType<typeof terminal.open>>) => void;
  terminal.open.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  let launch!: Promise<void>;
  act(() => { launch = view.result.current.runTerminalAction({ name: 'Start', command: 'pnpm dev' }); });
  const panelId = view.result.current.bottomActivePanel!.id;
  act(() => view.result.current.closeDesktopPanelItem('bottom', panelId));
  view.rerender({ targetIdentity: 'thread:B' });
  await act(async () => {
    resolve({ sessionId: 'late-action', workspaceRoot: '/repo', shell: 'zsh', cols: 100, rows: 24 });
    await launch;
  });
  expect(terminal.close).toHaveBeenCalledExactlyOnceWith('late-action');
  expect(view.result.current.terminalSessionsByPanelId).toEqual({});
  view.rerender({ targetIdentity: 'thread:A' });
  expect(view.result.current.bottomPanelSlot.panels).toEqual([]);
  expect(terminal.open).toHaveBeenCalledTimes(1);
});

it('removes a failed action tab and allows an explicit retry without silently opening a plain shell', async () => {
  const { view, terminal } = renderTerminalWorkspace();
  terminal.open.mockRejectedValueOnce(new Error('Directory unavailable'));
  const command = { name: 'Start', command: 'pnpm dev' };
  await act(async () => { await expect(view.result.current.runTerminalAction(command)).rejects.toThrow('Directory unavailable'); });
  expect(view.result.current.bottomPanelSlot.panels).toEqual([]);
  expect(terminal.open).toHaveBeenCalledTimes(1);
  await act(async () => { await view.result.current.runTerminalAction(command); });
  expect(terminal.open).toHaveBeenLastCalledWith('/repo', 100, 24, command);
  expect(view.result.current.bottomPanelSlot.panels).toHaveLength(1);
});

function renderTerminalWorkspace(targetIdentity: ChatComposerTargetIdentity = 'thread:A',
  project: WorkspaceProject = { id: 'project', path: '/repo', name: 'Repository', createdAt: '', updatedAt: '' },
  windowSessionKey: string | null = null) {
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
  const initialProps: { targetIdentity: ChatComposerTargetIdentity; project?: WorkspaceProject } = { targetIdentity };
  const view = renderHook(({ targetIdentity: identity, project: currentProject }) => useDesktopWorkspacePanels({
    activeProject: currentProject ?? project, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: identity, workspaceStatus: 'ready', setError: vi.fn(), windowSessionKey,
  }), {
    initialProps,
    wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}>
      <ToastProvider><ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary></ToastProvider>
    </I18nProvider>,
  });
  return { view, terminal, emit: (sessionId: string, event: DesktopTerminalEvent) => listeners.get(sessionId)?.forEach((listener) => listener(event)) };
}
