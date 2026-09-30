// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { browserTabMentionText } from '@setsuna-desktop/feature-browser/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import type { MainView } from '../../../../src/app/types.js';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../../../src/features/chat/hooks/useChatComposerSession.js';
import { desktopWorkspaceBrowserPanelInstances, useDesktopWorkspacePanelSession } from '../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { addPanelToSlotState, createBrowserPanel } from '../../../../src/features/workspace/model.js';

afterEach(cleanup);

it.each([true, false])('leaves the automation conversation when opening chat mode; has fallback=$0', async (hasFallback) => {
  const automation: RuntimeThread = {
    id: 'setup', featureId: 'automation', title: 'Setup', createdAt: '', updatedAt: '', archived: false,
    messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const ordinary = { ...automation, id: 'ordinary', featureId: undefined };
  const getThread = vi.fn(async () => ordinary);
  const { result } = renderHook(() => {
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(automation);
    const [activeView, setActiveView] = useState<MainView>('automation');
    const navigation = useDesktopNavigation({
      activeProjectId: null, setActiveProjectId: vi.fn(), currentThread, setCurrentThread,
      projects: [], setProjects: vi.fn(), setActiveView,
      client: { getThread } as unknown as DesktopRuntimeClient, confirmDiscardProjectFile: async () => true,
      globalThreads: hasFallback ? [ordinary] : [], threadsByProjectId: new Map(), reloadThreads: async () => [],
      resetProjectWorkspaceState: vi.fn(), resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
    });
    return { navigation, currentThread, activeView };
  });
  await act(() => result.current.navigation.enterChatMode());
  expect(result.current.activeView).toBe('chat');
  expect(result.current.currentThread?.id ?? null).toBe(hasFallback ? ordinary.id : null);
  expect(getThread).toHaveBeenCalledTimes(hasFallback ? 1 : 0);
});

it.each([
  { navigateAway: false, fromSidebar: false },
  { navigateAway: true, fromSidebar: false },
  { navigateAway: false, fromSidebar: true },
  { navigateAway: true, fromSidebar: true },
])('opens a fork in its original project; navigateAway=$navigateAway, fromSidebar=$fromSidebar', async ({ navigateAway, fromSidebar }) => {
  const source: RuntimeThread = { id: 'source', projectId: 'original', title: 'Source', createdAt: '', updatedAt: '',
    archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0 };
  const forked = { ...source, id: 'forked', workspaceId: 'worktree' };
  const other = { ...source, id: 'other' };
  const project: WorkspaceProject = { id: 'original', name: 'Original', createdAt: '', updatedAt: '' };
  const resetProjectWorkspaceState = vi.fn();
  const listProjects = vi.fn();
  let finish!: (thread: RuntimeThread) => void;
  const forkThread = vi.fn(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }));
  const reloadThreads = vi.fn(async () => [source, forked]);
  const { result } = renderHook(() => {
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(source);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(source.projectId!);
    const [projects, setProjects] = useState<WorkspaceProject[]>([project]);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, projects, setProjects, setActiveView: vi.fn(),
      client: { forkThread, getThread: async () => other, listProjects } as unknown as DesktopRuntimeClient,
      confirmDiscardProjectFile: async () => true, globalThreads: [], threadsByProjectId: new Map(), reloadThreads,
      resetProjectWorkspaceState, resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
    });
    return { navigation, currentThread, activeProjectId, projects };
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = fromSidebar
      ? result.current.navigation.forkThreadFromId('unselected-thread', { messageId: 'answer', target: 'worktree' })
      : result.current.navigation.forkThread({ messageId: 'answer', target: 'worktree' });
    await Promise.resolve();
  });
  if (navigateAway) await act(() => result.current.navigation.selectThread(other.id));
  await act(async () => { finish(forked); await pending; });
  expect(forkThread).toHaveBeenCalledWith(fromSidebar ? 'unselected-thread' : source.id, { messageId: 'answer', target: 'worktree' });
  expect(reloadThreads).toHaveBeenCalledTimes(1);
  expect(result.current.projects).toEqual([project]);
  expect(listProjects).not.toHaveBeenCalled();
  expect(resetProjectWorkspaceState).toHaveBeenCalledTimes(navigateAway ? 0 : 1);
  expect(result.current.currentThread?.id).toBe(navigateAway ? other.id : forked.id);
  expect(result.current.activeProjectId).toBe(project.id);
  if (!navigateAway) {
    await act(() => result.current.navigation.selectThread(other.id));
    expect(resetProjectWorkspaceState).toHaveBeenCalledTimes(2);
    expect(result.current.currentThread?.workspaceId).toBeUndefined();
  }
});

it('changes a new chat project without opening a conversation or losing its draft and composer session', async () => {
  const getThread = vi.fn();
  const resetProjectWorkspaceState = vi.fn();
  const confirmDiscardProjectFile = vi.fn().mockResolvedValue(true);
  const projects: WorkspaceProject[] = ['project_a', 'project_b'].map((id) => ({
    id, name: id, path: `/work/${id}`, createdAt: '', updatedAt: '',
  }));
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>('project_a');
    const composer = useChatComposerSession(chatComposerTargetIdentity(null, activeProjectId), {} as DesktopRuntimeClient);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread: null, setCurrentThread: vi.fn(),
      projects, setProjects: vi.fn(), setActiveView: vi.fn(),
      client: { getThread } as unknown as DesktopRuntimeClient,
      confirmDiscardProjectFile, globalThreads: [], threadsByProjectId: new Map(),
      reloadThreads: async () => [], resetProjectWorkspaceState,
      resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
      onNewThreadProjectChange: composer.claimForProject,
    });
    return { activeProjectId, composer, navigation };
  });
  act(() => result.current.composer.setDraft('Keep this unsent message'));
  const composerKey = result.current.composer.composerKey;

  // Cancelling an unsaved-file prompt must leave both the workspace and draft intact.
  confirmDiscardProjectFile.mockResolvedValueOnce(false);
  await act(() => result.current.navigation.selectNewThreadProject('project_b'));
  expect(result.current.activeProjectId).toBe('project_a');
  expect(resetProjectWorkspaceState).not.toHaveBeenCalled();

  for (const projectId of ['project_b', null, 'project_a']) {
    await act(() => result.current.navigation.selectNewThreadProject(projectId));
    expect(result.current.activeProjectId).toBe(projectId);
    expect(result.current.composer.draft).toBe('Keep this unsent message');
    expect(result.current.composer.composerKey).toBe(composerKey);
  }
  expect(getThread).not.toHaveBeenCalled();
  expect(resetProjectWorkspaceState).toHaveBeenCalledTimes(3);
  await act(() => result.current.navigation.selectNewThreadProject('removed-project'));
  expect(result.current.activeProjectId).toBe('project_a');
  expect(confirmDiscardProjectFile).toHaveBeenCalledTimes(4);
});

it('toggles project lists independently without navigating or disturbing the current workspace', () => {
  const currentThread: RuntimeThread = {
    id: 'thread_a', projectId: 'project_a', title: 'Current conversation',
    createdAt: '', updatedAt: '', archived: false, messageCount: 0,
    lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const otherThread = { ...currentThread, id: 'thread_b', projectId: 'project_b' };
  const projects: WorkspaceProject[] = ['project_a', 'project_b'].map((id) => ({
    id, name: id, createdAt: '', updatedAt: '',
  }));
  const getThread = vi.fn(async () => otherThread);
  const confirmDiscardProjectFile = vi.fn(async () => true);
  const resetProjectWorkspaceState = vi.fn();
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>('project_a');
    const [thread, setCurrentThread] = useState<RuntimeThread | null>(currentThread);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread: thread, setCurrentThread,
      projects, setProjects: vi.fn(), setActiveView: vi.fn(),
      client: { getThread } as unknown as DesktopRuntimeClient,
      confirmDiscardProjectFile, globalThreads: [],
      threadsByProjectId: new Map([['project_a', [currentThread]], ['project_b', [otherThread]]]),
      reloadThreads: async () => [], resetProjectWorkspaceState,
      resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
    });
    return { navigation, activeProjectId, thread };
  });

  act(() => result.current.navigation.expandProject('project_a'));
  for (const project of projects) {
    act(() => result.current.navigation.toggleProjectCollapsed(project.id));
    expect(result.current.navigation.collapsedProjectIds.has(project.id)).toBe(true);
    expect(result.current.navigation.forceExpandedProjectIds.has(project.id)).toBe(false);
  }
  act(() => result.current.navigation.toggleProjectCollapsed('project_b'));
  expect(result.current.navigation.collapsedProjectIds).toEqual(new Set(['project_a']));
  expect(result.current.activeProjectId).toBe('project_a');
  expect(result.current.thread).toBe(currentThread);
  expect(getThread).not.toHaveBeenCalled();
  expect(confirmDiscardProjectFile).not.toHaveBeenCalled();
  expect(resetProjectWorkspaceState).not.toHaveBeenCalled();
});

it.each([false, true])('starts a new chat from a restored thread when its project exists: %s', async (projectExists) => {
  const oldThread: RuntimeThread = {
    id: 'thread_old', projectId: 'project_old', title: 'Old conversation',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const project: WorkspaceProject = {
    id: 'project_old', name: 'Project', createdAt: oldThread.createdAt, updatedAt: oldThread.updatedAt,
  };
  const resetPanels = vi.fn();
  const resetProject = vi.fn();
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>(oldThread.projectId!);
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(oldThread);
    const [activeView, setActiveView] = useState<MainView>('settings');
    const [projects, setProjects] = useState(projectExists ? [project] : []);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, projects, setProjects, setActiveView,
      client: {} as DesktopRuntimeClient,
      confirmDiscardProjectFile: async () => true,
      globalThreads: [], threadsByProjectId: new Map(), reloadThreads: async () => [],
      resetNewThreadWorkspacePanels: resetPanels,
      resetProjectWorkspaceState: resetProject,
      resetThreadWorkspacePanels: vi.fn(),
    });
    return { navigation, activeProjectId, currentThread, activeView };
  });

  await act(() => result.current.navigation.startCurrentThread());

  const newProjectId = projectExists ? project.id : null;
  expect(result.current.activeProjectId).toBe(newProjectId);
  expect(result.current.currentThread).toBeNull();
  expect(result.current.activeView).toBe('chat');
  expect(resetPanels).not.toHaveBeenCalled();
  expect(resetProject).toHaveBeenCalledTimes(projectExists ? 0 : 1);
  expect(oldThread.projectId).toBe('project_old');
});

it.each([
  { entry: 'global', projectId: null },
  { entry: 'project', projectId: 'project_a' },
  { entry: 'current', projectId: null },
  { entry: 'current', projectId: 'project_a' },
] as const)('restores the draft and its browser sessions via $entry ($projectId)', async ({ entry, projectId }) => {
  const otherThread: RuntimeThread = {
    id: 'thread_other', projectId: projectId ?? undefined, title: 'Other conversation',
    createdAt: '', updatedAt: '', archived: false, messageCount: 0,
    lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const client = { getThread: vi.fn(async () => otherThread) } as unknown as DesktopRuntimeClient;
  const project: WorkspaceProject = { id: 'project_a', name: 'Project', createdAt: '', updatedAt: '' };
  const tab = { id: 'browser-draft', title: 'Draft page', url: 'https://example.com/' };
  const browser = createBrowserPanel(tab.id, tab.url);
  const draft = `Inspect ${browserTabMentionText(tab)}`;
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>(projectId);
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
    const identity = chatComposerTargetIdentity(currentThread?.id, activeProjectId);
    const composer = useChatComposerSession(identity, client);
    const panels = useDesktopWorkspacePanelSession(identity);
    const navigation = useDesktopNavigation({
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, client,
      projects: [project], setProjects: vi.fn(), setActiveView: vi.fn(),
      confirmDiscardProjectFile: async () => true,
      globalThreads: [], threadsByProjectId: new Map(), reloadThreads: async () => [],
      resetProjectWorkspaceState: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
      resetNewThreadWorkspacePanels: (id) => panels.resetForIdentity(chatComposerTargetIdentity(null, id)),
    });
    return { composer, panels, navigation, identity };
  });
  act(() => {
    result.current.composer.setDraft(draft);
    result.current.panels.setSidePanelSlot((slot) => addPanelToSlotState(slot, browser));
    result.current.panels.setSidePanelExpanded(true);
  });
  const originalKey = result.current.composer.composerKey;
  await act(() => result.current.navigation.selectThread(otherThread.id));
  expect(result.current.composer.draft).toBe('');

  await act(() => entry === 'global'
    ? result.current.navigation.startGlobalThread()
    : entry === 'project'
      ? result.current.navigation.startProjectThread(projectId!)
      : result.current.navigation.startCurrentThread());

  expect(result.current.composer.composerKey).toBe(originalKey);
  expect(result.current.composer.draft).toBe(draft);
  expect(desktopWorkspaceBrowserPanelInstances(result.current.panels.layouts, result.current.identity, {
    bottomVisible: false, sideVisible: true,
  })).toEqual([{ active: true, panel: browser, placement: 'side', targetIdentity: result.current.identity }]);
});
