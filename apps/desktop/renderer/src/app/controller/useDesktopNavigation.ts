import type {
  DesktopRuntimeClient,
  ForkThreadInput,
  RuntimeThread,
  RuntimeThreadSummary,
  UpdateWorkspaceProjectInput,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import type { MainView } from '../types.js';
import { isThreadDeletionCancelled, RuntimeClientError } from '../../services/runtime-client/runtimeClientErrors.js';
import { isPrimaryConversationThread } from '../../services/runtime-client/runtimeThreadRelations.js';

type DesktopNavigationOptions = {
  activeProjectId: string | null;
  activeView: MainView;
  client: DesktopRuntimeClient;
  confirmDiscardProjectFile: () => Promise<boolean>;
  currentThread: RuntimeThread | null;
  globalThreads: RuntimeThreadSummary[];
  onNewThreadProjectChange?: (projectId: string | null) => void;
  projects: WorkspaceProject[];
  reloadThreads: () => Promise<RuntimeThreadSummary[]>;
  resetNewThreadWorkspacePanels: (projectId: string | null) => void;
  resetProjectWorkspaceState: () => void;
  resetThreadWorkspacePanels: (threadId: string) => void;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
};

type ProjectEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; project: WorkspaceProject };

export function useDesktopNavigation({
  activeProjectId,
  activeView,
  client,
  confirmDiscardProjectFile,
  currentThread,
  globalThreads,
  onNewThreadProjectChange,
  projects,
  reloadThreads,
  resetNewThreadWorkspacePanels,
  resetProjectWorkspaceState,
  resetThreadWorkspacePanels,
  setActiveProjectId,
  setActiveView,
  setCurrentThread,
  setProjects,
  threadsByProjectId,
}: DesktopNavigationOptions) {
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchValue, setSidebarSearchValue] = useState('');
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [forceExpandedProjectIds, setForceExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [projectEditor, setProjectEditor] = useState<ProjectEditorState | null>(null);
  const [projectActionMenuId, setProjectActionMenuId] = useState<string | null>(null);
  const [threadActionMenuId, setThreadActionMenuId] = useState<string | null>(null);
  const [renamingThread, setRenamingThread] = useState<RuntimeThreadSummary | null>(null);
  const [renameThreadTitle, setRenameThreadTitle] = useState('');
  const navigationRequests = useLatestRequestGuard();
  const currentProjectId = currentThread ? currentThread.projectId ?? null : activeProjectId;
  const currentWorkspaceId = currentThread?.workspaceId ?? currentThread?.projectId ?? currentThread?.id ?? activeProjectId;
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const chatBeforeAutomation = useRef<{ threadId: string | null; projectId: string | null } | null>(null);

  const changeView = useCallback(async (action: SetStateAction<MainView>) => {
    const nextView = typeof action === 'function' ? action(activeViewRef.current) : action;
    if (nextView === activeViewRef.current) return;
    const isLatest = navigationRequests.begin();
    if (activeViewRef.current === 'automation' && nextView !== 'automation') {
      const previous = chatBeforeAutomation.current ?? { threadId: null, projectId: null };
      if ((currentThread?.id ?? null) !== previous.threadId || currentProjectId !== previous.projectId) {
        if (!await confirmDiscardProjectFile() || !isLatest()) return;
        let thread: RuntimeThread | null = null;
        if (previous.threadId) {
          try { thread = await client.getThread(previous.threadId); }
          catch (error) {
            if (!isLatest()) return;
            if (!(error instanceof RuntimeClientError) || error.code !== 'thread_not_found') throw error;
          }
        }
        if (!isLatest()) return;
        const projectId = thread ? thread.projectId ?? null : previous.projectId;
        const workspaceId = thread?.workspaceId ?? thread?.projectId ?? thread?.id ?? projectId;
        if (workspaceId !== currentWorkspaceId) resetProjectWorkspaceState();
        setActiveProjectId(projectId);
        // A deletion event cannot be replayed after its stream is removed.
        // Restore a fresh snapshot, or the project's new-chat slot if deleted.
        setCurrentThread(thread);
      }
    }
    if (nextView === 'automation' && activeViewRef.current !== 'automation') {
      // Automation borrows the conversation surface, not the chat destination.
      // Preserve null as well: a new-chat draft must return to its own slot.
      const isChat = !currentThread || isPrimaryConversationThread(currentThread);
      chatBeforeAutomation.current = {
        threadId: isChat ? currentThread?.id ?? null : null,
        projectId: isChat ? currentProjectId : null,
      };
    }
    activeViewRef.current = nextView;
    setActiveView(nextView);
  }, [client, confirmDiscardProjectFile, currentProjectId, currentThread, currentWorkspaceId, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const closeNavigationMenus = useCallback(() => {
    setProjectActionMenuId(null);
    setThreadActionMenuId(null);
  }, []);

  const expandProject = useCallback((projectId: string) => {
    setProjectsCollapsed(false);
    setCollapsedProjectIds((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setForceExpandedProjectIds((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  // New-chat entry points restore draft slots, including browser tabs referenced
  // by the draft. Panel ownership transfers when the first thread is created.
  const startCurrentThread = useCallback(async () => {
    if (!await confirmDiscardProjectFile()) return;
    // Restored conversations may reference removed projects. A new chat must not
    // inherit that orphaned reference and fail before its first model request.
    const projectId = projects.some((project) => project.id === activeProjectId) ? activeProjectId : null;
    navigationRequests.invalidate();
    setActiveView('chat');
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    if (currentWorkspaceId !== projectId) resetProjectWorkspaceState();
    setActiveProjectId(projectId);
    setCurrentThread(null);
    if (projectId) {
      expandProject(projectId);
    } else {
      setSessionsCollapsed(false);
    }
  }, [activeProjectId, confirmDiscardProjectFile, currentWorkspaceId, expandProject, navigationRequests, projects, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const startGlobalThread = useCallback(async () => {
    if (!await confirmDiscardProjectFile()) return;
    navigationRequests.invalidate();
    setActiveView('chat');
    setSessionsCollapsed(false);
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    resetProjectWorkspaceState();
    setActiveProjectId(null);
    setCurrentThread(null);
  }, [confirmDiscardProjectFile, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const startProjectThread = useCallback(
    async (projectId: string) => {
      if (!await confirmDiscardProjectFile()) return;
      navigationRequests.invalidate();
      setActiveView('chat');
      setThreadActionMenuId(null);
      setProjectActionMenuId(null);
      if (projectId !== currentWorkspaceId) resetProjectWorkspaceState();
      setActiveProjectId(projectId);
      expandProject(projectId);
      setCurrentThread(null);
    },
    [confirmDiscardProjectFile, currentWorkspaceId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
  );

  const selectThreadInView = useCallback(
    async (threadId: string, view: MainView): Promise<boolean> => {
      // Feature callbacks may finish after their route has already unmounted.
      if (view !== 'chat' && view !== activeViewRef.current) return false;
      const isLatest = navigationRequests.begin();
      if (!await confirmDiscardProjectFile() || !isLatest()) return false;
      setThreadActionMenuId(null);
      const thread = await client.getThread(threadId);
      if (!isLatest()) return false;
      // Commit the route with its thread, so history never sees the old chat on
      // an intermediate page while the requested conversation is still loading.
      setActiveView(view);
      if ((thread.workspaceId ?? thread.projectId ?? thread.id) !== currentWorkspaceId) resetProjectWorkspaceState();
      if (thread.projectId) {
        setActiveProjectId(thread.projectId);
        expandProject(thread.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(thread);
      return true;
    },
    [client, confirmDiscardProjectFile, currentWorkspaceId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
  );

  const selectThread = useCallback(async (threadId: string) => {
    await selectThreadInView(threadId, 'chat');
  }, [selectThreadInView]);

  const forkThreadFromId = useCallback(async (threadId: string, input: ForkThreadInput) => {
    const isLatest = navigationRequests.begin();
    if (!await confirmDiscardProjectFile() || !isLatest()) return;
    const forked = await client.forkThread(threadId, input);
    await reloadThreads();
    // Worktree creation can outlive navigation to another conversation.
    if (!isLatest()) return;
    if ((forked.workspaceId ?? forked.projectId ?? forked.id) !== currentWorkspaceId) resetProjectWorkspaceState();
    setActiveView('chat');
    setActiveProjectId(forked.projectId ?? null);
    if (forked.projectId) expandProject(forked.projectId);
    setCurrentThread(forked);
  }, [client, confirmDiscardProjectFile, currentWorkspaceId, expandProject, navigationRequests, reloadThreads, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const forkThread = useCallback(async (input: ForkThreadInput) => {
    if (currentThread) await forkThreadFromId(currentThread.id, input);
  }, [currentThread, forkThreadFromId]);

  const selectNewThreadProject = useCallback(async (projectId: string | null) => {
    if (currentThread || projectId === activeProjectId) return;
    if (projectId !== null && !projects.some((project) => project.id === projectId)) return;
    const isLatest = navigationRequests.begin();
    if (!await confirmDiscardProjectFile() || !isLatest()) return;
    onNewThreadProjectChange?.(projectId);
    resetProjectWorkspaceState();
    setActiveProjectId(projectId);
    if (projectId) expandProject(projectId);
  }, [activeProjectId, confirmDiscardProjectFile, currentThread, expandProject, navigationRequests, onNewThreadProjectChange, projects, resetProjectWorkspaceState, setActiveProjectId]);

  const openRenameThread = useCallback((thread: RuntimeThreadSummary) => {
    setThreadActionMenuId(null);
    setRenamingThread(thread);
    setRenameThreadTitle(thread.title);
  }, []);

  const closeRenameThread = useCallback(() => {
    setRenamingThread(null);
    setRenameThreadTitle('');
  }, []);

  const saveRenameThread = useCallback(async () => {
    if (!renamingThread) return;
    const title = renameThreadTitle.trim();
    if (!title) return;
    const updated = await client.updateThread(renamingThread.id, { title });
    setCurrentThread((thread) => (thread?.id === updated.id ? updated : thread));
    await reloadThreads();
    closeRenameThread();
  }, [client, closeRenameThread, reloadThreads, renameThreadTitle, renamingThread, setCurrentThread]);

  const hideThreadFromNavigation = useCallback(
    async (thread: RuntimeThreadSummary, persist: () => Promise<unknown>, deleting = false) => {
      // Deletion checks every window in main; do not discard this window's draft
      // early, since another window can still cancel or the request can fail.
      if (!deleting && currentThread?.id === thread.id && !await confirmDiscardProjectFile()) return;
      const isLatest = navigationRequests.begin();
      setThreadActionMenuId(null);
      try {
        await persist();
      } catch (error) {
        if (isThreadDeletionCancelled(error)) return;
        throw error;
      }
      resetThreadWorkspacePanels(thread.id);
      const nextThreads = await reloadThreads();
      if (!isLatest()) return;
      if (currentThread?.id !== thread.id) return;
      const fallbackSummary =
        (thread.projectId ? nextThreads.find((item) => item.projectId === thread.projectId) : nextThreads.find((item) => !item.projectId)) ??
        nextThreads[0];
      if (!fallbackSummary) {
        resetProjectWorkspaceState();
        setCurrentThread(null);
        return;
      }
      const fallback = await client.getThread(fallbackSummary.id);
      if (!isLatest()) return;
      if ((fallback.workspaceId ?? fallback.projectId ?? fallback.id) !== currentWorkspaceId) resetProjectWorkspaceState();
      if (fallback.projectId) {
        setActiveProjectId(fallback.projectId);
        expandProject(fallback.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(fallback);
    },
    [client, confirmDiscardProjectFile, currentThread?.id, currentWorkspaceId, expandProject, navigationRequests, reloadThreads, resetProjectWorkspaceState, resetThreadWorkspacePanels, setActiveProjectId, setCurrentThread],
  );

  const archiveThread = useCallback(
    (thread: RuntimeThreadSummary) => hideThreadFromNavigation(thread, () => client.updateThread(thread.id, { archived: true })),
    [client, hideThreadFromNavigation],
  );

  const deleteThread = useCallback(
    (thread: RuntimeThreadSummary) => hideThreadFromNavigation(thread, () => client.deleteThread(thread.id), true),
    [client, hideThreadFromNavigation],
  );

  const enterChatMode = useCallback(async () => {
    if (!await confirmDiscardProjectFile()) return;
    const isLatest = navigationRequests.begin();
    setActiveView('chat');
    setSessionsCollapsed(false);
    setActiveProjectId(null);
    if (currentProjectId) resetProjectWorkspaceState();
    if (!currentThread || (!currentThread.projectId && isPrimaryConversationThread(currentThread))) return;
    const fallback = globalThreads[0];
    if (!fallback) {
      setCurrentThread(null);
      return;
    }
    const thread = await client.getThread(fallback.id);
    if (isLatest()) setCurrentThread(thread);
  }, [client, confirmDiscardProjectFile, currentProjectId, currentThread, globalThreads, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setForceExpandedProjectIds((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const openCreateProject = useCallback(() => {
    setProjectActionMenuId(null);
    setProjectEditor({ mode: 'create' });
  }, []);

  const editProject = useCallback((project: WorkspaceProject) => {
    setProjectActionMenuId(null);
    setProjectEditor({ mode: 'edit', project });
  }, []);

  const closeProjectEditor = useCallback(() => setProjectEditor(null), []);

  const saveProject = useCallback(async (input: UpdateWorkspaceProjectInput) => {
    if (!projectEditor) return false;
    const existingProject = projectEditor.mode === 'edit' ? projectEditor.project : null;
    const nextPath = input.path === undefined
      ? existingProject?.path
      : input.path ?? undefined;
    const pathChanged = existingProject !== null && existingProject.path !== nextPath;
    const changesCurrentWorkspace = existingProject === null
      || (existingProject.id === currentProjectId && pathChanged);
    if (changesCurrentWorkspace && !await confirmDiscardProjectFile()) {
      return false;
    }
    const project = existingProject
      ? await client.updateProject(existingProject.id, input)
      : await client.addProject({
          ...(input.name ? { name: input.name } : {}),
          ...(nextPath ? { path: nextPath } : {}),
        });
    const list = await client.listProjects();
    setProjects(list.projects);
    if (!existingProject) {
      if (!currentThread) onNewThreadProjectChange?.(project.id);
      setActiveProjectId(project.id);
      expandProject(project.id);
      resetNewThreadWorkspacePanels(project.id);
    }
    if (changesCurrentWorkspace) resetProjectWorkspaceState();
    return true;
  }, [client, confirmDiscardProjectFile, currentProjectId, currentThread, expandProject, onNewThreadProjectChange, projectEditor, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setProjects]);

  const hideProjectFromNavigation = useCallback(
    async (project: WorkspaceProject, persist: () => Promise<void>) => {
      if (!await confirmDiscardProjectFile()) return false;
      await persist();
      const list = await client.listProjects();
      const nextThreads = await reloadThreads();
      setProjects(list.projects);
      setActiveProjectId((current) => (current === project.id ? null : current));
      setCollapsedProjectIds((current) => {
        if (!current.has(project.id)) return current;
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      setForceExpandedProjectIds((current) => {
        if (!current.has(project.id)) return current;
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      if (currentThread?.projectId === project.id) {
        const fallbackSummary = nextThreads.find((thread) => !thread.projectId) ?? nextThreads[0];
        if (!fallbackSummary) {
          setCurrentThread(null);
        } else {
          const fallback = await client.getThread(fallbackSummary.id);
          if (fallback.projectId) {
            setActiveProjectId(fallback.projectId);
            expandProject(fallback.projectId);
          } else {
            setActiveProjectId(null);
          }
          setCurrentThread(fallback);
        }
      }
      for (const thread of threadsByProjectId.get(project.id) ?? []) {
        resetThreadWorkspacePanels(thread.id);
      }
      resetNewThreadWorkspacePanels(project.id);
      resetProjectWorkspaceState();
      return true;
    },
    [client, confirmDiscardProjectFile, currentThread?.projectId, expandProject, reloadThreads, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, resetThreadWorkspacePanels, setActiveProjectId, setCurrentThread, setProjects, threadsByProjectId],
  );

  const archiveProject = useCallback(
    (project: WorkspaceProject) => hideProjectFromNavigation(
      project,
      () => client.archiveProject(project.id),
    ),
    [client, hideProjectFromNavigation],
  );

  const removeProject = useCallback(
    (project: WorkspaceProject) => hideProjectFromNavigation(
      project,
      () => client.removeProject(project.id),
    ),
    [client, hideProjectFromNavigation],
  );

  return {
    archiveProject,
    archiveThread,
    changeView,
    deleteThread,
    closeNavigationMenus,
    closeRenameThread,
    collapsedProjectIds,
    enterChatMode,
    expandProject,
    editProject,
    forceExpandedProjectIds,
    openRenameThread,
    closeProjectEditor,
    openCreateProject,
    projectEditor,
    projectActionMenuId,
    projectsCollapsed,
    removeProject,
    renameThreadTitle,
    renamingThread,
    saveRenameThread,
    saveProject,
    selectNewThreadProject,
    selectThread,
    selectThreadInView,
    forkThread,
    forkThreadFromId,
    sessionsCollapsed,
    setProjectActionMenuId,
    setProjectsCollapsed,
    setRenameThreadTitle,
    setSessionsCollapsed,
    setSidebarSearchOpen,
    setSidebarSearchValue,
    setThreadActionMenuId,
    sidebarSearchOpen,
    sidebarSearchValue,
    startCurrentThread,
    startGlobalThread,
    startProjectThread,
    threadActionMenuId,
    toggleProjectCollapsed,
  };
}

export type DesktopNavigationState = ReturnType<typeof useDesktopNavigation>;
