// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import type { MainView } from '../../../../src/app/types.js';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../../../src/features/chat/hooks/useChatComposerSession.js';

afterEach(cleanup);

it('changes a new chat project without opening a conversation or losing its draft and composer session', async () => {
  const getThread = vi.fn();
  const resetProjectWorkspaceState = vi.fn();
  const confirmDiscardProjectFile = vi.fn().mockResolvedValue(true);
  const projects: WorkspaceProject[] = ['project_a', 'project_b'].map((id) => ({
    id, name: id, path: `/work/${id}`, createdAt: '', updatedAt: '',
  }));
  const { result } = renderHook(() => {
    const [activeProjectId, setActiveProjectId] = useState<string | null>('project_a');
    const composer = useChatComposerSession(chatComposerTargetIdentity(null, activeProjectId));
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
  expect(resetPanels).toHaveBeenCalledWith(newProjectId);
  expect(resetProject).toHaveBeenCalledTimes(projectExists ? 0 : 1);
  expect(oldThread.projectId).toBe('project_old');
});
