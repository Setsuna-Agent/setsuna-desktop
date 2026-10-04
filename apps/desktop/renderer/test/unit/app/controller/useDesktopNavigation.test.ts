// @vitest-environment happy-dom
import { parsePluginMentions, pluginMentionText, type DesktopRuntimeClient, type RuntimeThread, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { browserTabMentionText } from '@setsuna-desktop/feature-browser/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import { RuntimeClientError } from '../../../../src/services/runtime-client/runtimeClientErrors.js';
import type { MainView } from '../../../../src/app/types.js';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useChatTurnActions } from '../../../../src/features/chat/hooks/useChatTurnActions.js';
import { desktopWorkspaceBrowserPanelInstances, useDesktopWorkspacePanelSession } from '../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { addPanelToSlotState, createBrowserPanel } from '../../../../src/features/workspace/model.js';

afterEach(cleanup);

const automationThread: RuntimeThread = {
  id: 'automation', featureId: 'automation', title: 'New automation', archived: false,
  createdAt: '', updatedAt: '', messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
};

function setupAutomationNavigation(initialThread: RuntimeThread | null, projectId: string | null = null) {
  const getThread = vi.fn(async (id: string): Promise<RuntimeThread> => id === initialThread?.id ? initialThread : automationThread);
  const confirmDiscardProjectFile = vi.fn(async () => true);
  const createThread = vi.fn(async (): Promise<RuntimeThread> => ({ ...automationThread, id: 'created', featureId: undefined }));
  const sendTurn = vi.fn(async () => ({ turnId: 'turn-1' }));
  const reloadThreads = vi.fn(async () => []);
  const client = { getThread, createThread, sendTurn } as unknown as DesktopRuntimeClient;
  const hook = renderHook(() => {
    const [activeView, setActiveView] = useState<MainView>('chat');
    const [activeProjectId, setActiveProjectId] = useState(projectId);
    const [currentThread, setCurrentThread] = useState(initialThread);
    const [newThreadDraftId, setNewThreadDraftId] = useState<string | null>(null);
    const composer = useChatComposerSession(chatComposerTargetIdentity(currentThread?.id, activeProjectId, newThreadDraftId), client);
    const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
    const terminalTurnIdsRef = useRef(new Set<string>());
    const navigation = useDesktopNavigation({
      activeView, setActiveView, activeProjectId, setActiveProjectId, currentThread, setCurrentThread, client,
      confirmDiscardProjectFile, projects: [{ id: 'project', name: 'Project', createdAt: '', updatedAt: '' }], setProjects: vi.fn(), globalThreads: [],
      onNewThreadProjectChange: composer.claimForProject,
      setNewThreadDraftId,
      threadsByProjectId: new Map(), reloadThreads, resetProjectWorkspaceState: vi.fn(),
      resetNewThreadWorkspacePanels: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
    });
    const actions = useChatTurnActions({
      activeProjectId, activeTurnId, client, composerKey: composer.composerKey, currentThread,
      draft: composer.draft, claimComposerForThread: (threadId) => {
        composer.claimForThread(threadId);
        setNewThreadDraftId(null);
      }, reloadThreads,
      setActiveTurnId, setCurrentThread, setDraft: composer.setDraft, setError: vi.fn(), terminalTurnIdsRef,
    });
    return { navigation, activeView, currentThread, activeProjectId, newThreadDraftId, composer, actions, setCurrentThread };
  });
  return { ...hook, getThread, createThread, sendTurn, reloadThreads, confirmDiscardProjectFile };
}

it.each(['global', 'project', 'thread'])('opens an unsent app draft while retaining the source input (%s)', async (source) => {
  const projectId = source === 'project' ? 'project' : null;
  const original = source === 'thread' ? { ...automationThread, id: 'ordinary', featureId: undefined } : null;
  const { result, createThread, sendTurn, reloadThreads } = setupAutomationNavigation(original, projectId);
  act(() => result.current.composer.setDraft('Keep my unsent message'));
  const oldComposerKey = result.current.composer.composerKey;
  const oldAttachments = result.current.composer.attachmentStore;
  const plugin = { id: 'app-builder', name: '应用构建器' };
  const prompt = '创建一个对话汇总应用';
  await act(async () => {
    expect(await result.current.navigation.startGlobalThread(() => {
      return result.current.composer.initializeNewThreadDraft(null, `${pluginMentionText(plugin)} ${prompt}`);
    })).toBe(true);
  });
  expect(createThread).not.toHaveBeenCalled();
  expect(reloadThreads).not.toHaveBeenCalled();
  expect(result.current.activeView).toBe('chat');
  expect(result.current.activeProjectId).toBeNull();
  expect(result.current.currentThread).toBeNull();
  expect(result.current.composer.composerKey).not.toBe(oldComposerKey);
  expect(result.current.composer.draft).toBe(`${pluginMentionText(plugin)} ${prompt}`);
  expect(parsePluginMentions(result.current.composer.draft)).toEqual([expect.objectContaining({ pluginId: 'app-builder' })]);
  expect(sendTurn).not.toHaveBeenCalled();
  const appDraftId = result.current.newThreadDraftId;
  await act(async () => {
    if (original) await result.current.navigation.selectThread(original.id);
    else if (projectId) await result.current.navigation.startProjectThread(projectId);
    else await result.current.navigation.startGlobalThread();
  });
  expect(result.current.composer.draft).toBe('Keep my unsent message');
  expect(result.current.composer.attachmentStore).toBe(oldAttachments);
  // History can return to the unsent app without replacing the original draft.
  await act(() => result.current.navigation.startGlobalThread(() => appDraftId));
  expect(result.current.composer.draft).toBe(`${pluginMentionText(plugin)} ${prompt}`);
  expect(createThread).not.toHaveBeenCalled();
});

it('does not create or prefill an app chat when the workspace transition is cancelled', async () => {
  const { result, createThread, confirmDiscardProjectFile } = setupAutomationNavigation(null, 'project');
  confirmDiscardProjectFile.mockResolvedValueOnce(false);
  const prefill = vi.fn();
  await act(async () => expect(await result.current.navigation.startGlobalThread(prefill)).toBe(false));
  expect(createThread).not.toHaveBeenCalled();
  expect(prefill).not.toHaveBeenCalled();
  expect(result.current.activeProjectId).toBe('project');
});

it('creates the app conversation only on send, using the project and location selected after prefilling', async () => {
  const { result, createThread, sendTurn } = setupAutomationNavigation(null);
  act(() => result.current.composer.setDraft('Original projectless input'));
  await act(() => result.current.navigation.startProjectThread('project'));
  act(() => result.current.composer.setDraft('Original project input'));
  const draft = `${pluginMentionText({ id: 'app-builder', name: '应用构建器' })} 创建表格`;
  await act(() => result.current.navigation.startGlobalThread(() => {
    return result.current.composer.initializeNewThreadDraft(null, draft);
  }));
  const composerKey = result.current.composer.composerKey;
  await act(() => result.current.navigation.selectNewThreadProject('project'));
  expect(result.current.currentThread).toBeNull();
  expect(result.current.composer.draft).toBe(draft);
  expect(result.current.composer.composerKey).toBe(composerKey);
  expect(createThread).not.toHaveBeenCalled();
  expect(sendTurn).not.toHaveBeenCalled();

  await act(async () => expect(await result.current.actions.sendInput(undefined, { workspaceMode: 'worktree' })).toBe(true));
  expect(createThread).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', workspaceMode: 'worktree' });
  expect(sendTurn).toHaveBeenCalledExactlyOnceWith('created', expect.objectContaining({ input: draft }));
  expect(result.current.currentThread?.id).toBe('created');
  expect(result.current.composer.composerKey).toBe(composerKey);
  expect(result.current.composer.draft).toBe('');
  await act(() => result.current.navigation.startProjectThread('project'));
  expect(result.current.composer.draft).toBe('Original project input');
  await act(() => result.current.navigation.startGlobalThread());
  expect(result.current.composer.draft).toBe('Original projectless input');
});

it('ignores a pending app draft navigation after another conversation is selected', async () => {
  const original = { ...automationThread, id: 'ordinary', featureId: undefined };
  const { result, createThread, confirmDiscardProjectFile } = setupAutomationNavigation(original);
  let finish!: (confirmed: boolean) => void;
  confirmDiscardProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const prefill = vi.fn();
  let pending!: Promise<boolean>;
  act(() => { pending = result.current.navigation.startGlobalThread(prefill); });
  await act(() => result.current.navigation.selectThread(original.id));
  await act(async () => { finish(true); expect(await pending).toBe(false); });
  expect(prefill).not.toHaveBeenCalled();
  expect(createThread).not.toHaveBeenCalled();
  expect(result.current.currentThread?.id).toBe(original.id);
});

it.each(['loaded', 'failed'] as const)('commits the chat route only with its requested conversation: %s', async (outcome) => {
  const original = { ...automationThread, id: 'ordinary', featureId: undefined };
  const target = { ...original, id: 'another-chat' };
  const { result, getThread } = setupAutomationNavigation(original);
  await act(() => result.current.navigation.changeView('settings'));
  let finish!: (thread: RuntimeThread) => void;
  let fail!: (error: Error) => void;
  getThread.mockImplementationOnce(() => new Promise<RuntimeThread>((resolve, reject) => { finish = resolve; fail = reject; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = result.current.navigation.selectThreadInView(target.id, 'chat'); });
  expect(result.current.activeView).toBe('settings');
  expect(result.current.currentThread).toEqual(original);
  await act(async () => {
    if (outcome === 'loaded') {
      finish(target);
      expect(await pending).toBe(true);
    } else {
      fail(new Error('Unavailable'));
      await expect(pending).rejects.toThrow('Unavailable');
    }
  });
  expect(result.current.activeView).toBe(outcome === 'loaded' ? 'chat' : 'settings');
  expect(result.current.currentThread).toEqual(outcome === 'loaded' ? target : original);
});

it.each([
  { existing: false, projectId: null, viaSettings: false },
  { existing: false, projectId: 'project', viaSettings: false },
  { existing: true, projectId: null, viaSettings: false },
  { existing: true, projectId: 'project', viaSettings: true },
])('restores the chat and its draft after automation: %j', async ({ existing, projectId, viaSettings }) => {
  const original = existing
    ? { ...automationThread, id: 'ordinary', featureId: undefined, projectId: projectId ?? undefined }
    : null;
  const { result } = setupAutomationNavigation(original, projectId);
  act(() => result.current.composer.setDraft('Unsent chat draft'));
  const composerKey = result.current.composer.composerKey;

  // Re-entering must preserve the destination, rather than adopting the last
  // setup conversation or its draft on the second visit.
  for (let visit = 0; visit < 2; visit += 1) {
    await act(() => result.current.navigation.changeView('automation'));
    await act(() => result.current.navigation.selectThreadInView(automationThread.id, 'automation'));
    expect(result.current.currentThread?.id).toBe(automationThread.id);
    expect(result.current.activeProjectId).toBeNull();
    act(() => result.current.composer.setDraft('Automation draft'));
    if (viaSettings) await act(() => result.current.navigation.changeView('settings'));
    await act(() => result.current.navigation.changeView('chat'));

    expect(result.current.activeView).toBe('chat');
    expect(result.current.currentThread).toEqual(original);
    expect(result.current.activeProjectId).toBe(projectId);
    expect(result.current.composer.draft).toBe('Unsent chat draft');
    expect(result.current.composer.composerKey).toBe(composerKey);
  }
});

it.each(['confirmation', 'fetch', 'unmounted'] as const)(
  'ignores an automation selection that finishes after leaving during %s', async (stage) => {
    const original = { ...automationThread, id: 'ordinary', featureId: undefined };
    const { result, getThread, confirmDiscardProjectFile } = setupAutomationNavigation(original);
    await act(() => result.current.navigation.changeView('automation'));
    const openConversation = result.current.navigation.selectThreadInView;
    let finish!: () => void;
    if (stage === 'confirmation') {
      confirmDiscardProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(true); }));
    } else if (stage === 'fetch') {
      getThread.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(automationThread); }));
    }
    let pending!: Promise<boolean>;
    if (stage !== 'unmounted') {
      await act(async () => {
        pending = openConversation(automationThread.id, 'automation');
        await Promise.resolve();
      });
    }
    // SSE updates can still arrive before the setup conversation takes over.
    const updated = { ...original, title: 'Latest title', lastSeq: 2 };
    act(() => result.current.setCurrentThread(updated));
    await act(() => result.current.navigation.changeView('chat'));
    await act(async () => {
      if (stage === 'unmounted') pending = openConversation(automationThread.id, 'automation');
      else finish();
      expect(await pending).toBe(false);
    });
    expect(result.current.activeView).toBe('chat');
    expect(result.current.currentThread).toEqual(updated);
  },
);

it('keeps the automation workspace when discarding its file changes is cancelled', async () => {
  const { result, confirmDiscardProjectFile } = setupAutomationNavigation(null);
  await act(() => result.current.navigation.changeView('automation'));
  await act(() => result.current.navigation.selectThreadInView(automationThread.id, 'automation'));
  confirmDiscardProjectFile.mockResolvedValueOnce(false);
  await act(() => result.current.navigation.changeView('chat'));
  expect(result.current.activeView).toBe('automation');
  expect(result.current.currentThread?.id).toBe(automationThread.id);
  await act(() => result.current.navigation.changeView('chat'));
  expect(result.current.activeView).toBe('chat');
  expect(result.current.currentThread).toBeNull();
});

it.each(['updated', 'deleted', 'unavailable'] as const)('revalidates the original chat after automation: %s', async (state) => {
  const original = { ...automationThread, id: 'ordinary', featureId: undefined };
  const { result, getThread } = setupAutomationNavigation(original);
  await act(() => result.current.navigation.changeView('automation'));
  await act(() => result.current.navigation.selectThreadInView(automationThread.id, 'automation'));
  const updated = { ...original, lastSeq: 20, title: 'Updated while away' };
  if (state === 'updated') getThread.mockResolvedValueOnce(updated);
  else getThread.mockRejectedValueOnce(new RuntimeClientError(state === 'deleted' ? 'thread_not_found' : 'INTERNAL', 'Lookup failed'));
  await act(async () => {
    const returning = result.current.navigation.changeView('chat');
    if (state === 'unavailable') await expect(returning).rejects.toThrow('Lookup failed');
    else await returning;
  });
  expect(getThread).toHaveBeenLastCalledWith(original.id);
  expect(result.current.activeView).toBe(state === 'unavailable' ? 'automation' : 'chat');
  expect(result.current.currentThread).toEqual(state === 'updated' ? updated : state === 'deleted' ? null : automationThread);
});

it('does not let a late chat restoration replace a newer navigation', async () => {
  const original = { ...automationThread, id: 'ordinary', featureId: undefined };
  const { result, getThread } = setupAutomationNavigation(original);
  await act(() => result.current.navigation.changeView('automation'));
  await act(() => result.current.navigation.selectThreadInView(automationThread.id, 'automation'));
  let finish!: (thread: RuntimeThread) => void;
  getThread.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  let returning!: Promise<void>;
  await act(async () => {
    returning = result.current.navigation.changeView('chat');
    await Promise.resolve();
  });
  await act(() => result.current.navigation.startGlobalThread());
  await act(async () => { finish(original); await returning; });
  expect(result.current.currentThread).toBeNull();
  expect(result.current.activeView).toBe('chat');
});

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
      projects: [], setProjects: vi.fn(), activeView, setActiveView,
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
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, projects, setProjects, activeView: 'chat', setActiveView: vi.fn(),
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
      projects, setProjects: vi.fn(), activeView: 'chat', setActiveView: vi.fn(),
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
      projects, setProjects: vi.fn(), activeView: 'chat', setActiveView: vi.fn(),
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
      activeProjectId, setActiveProjectId, currentThread, setCurrentThread, projects, setProjects, activeView, setActiveView,
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
      projects: [project], setProjects: vi.fn(), activeView: 'chat', setActiveView: vi.fn(),
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

  await act(async () => {
    if (entry === 'global') await result.current.navigation.startGlobalThread();
    else if (entry === 'project') await result.current.navigation.startProjectThread(projectId!);
    else await result.current.navigation.startCurrentThread();
  });

  expect(result.current.composer.composerKey).toBe(originalKey);
  expect(result.current.composer.draft).toBe(draft);
  expect(desktopWorkspaceBrowserPanelInstances(result.current.panels.layouts, result.current.identity, {
    bottomVisible: false, sideVisible: true,
  })).toEqual([{ active: true, panel: browser, placement: 'side', targetIdentity: result.current.identity }]);
});
