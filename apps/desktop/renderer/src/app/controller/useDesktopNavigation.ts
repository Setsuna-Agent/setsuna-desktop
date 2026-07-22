import type {
  DesktopRuntimeClient,
  RuntimeThread,
  RuntimeThreadSummary,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import type { MainView } from '../types.js';

type DesktopNavigationOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  currentThread: RuntimeThread | null;
  globalThreads: RuntimeThreadSummary[];
  reloadThreads: () => Promise<RuntimeThreadSummary[]>;
  resetNewThreadWorkspacePanels: (projectId: string | null) => void;
  resetProjectWorkspaceState: () => void;
  resetThreadWorkspacePanels: (threadId: string) => void;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setProjects: Dispatch<SetStateAction<WorkspaceProject[]>>;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
};

export function useDesktopNavigation({
  activeProjectId,
  client,
  currentThread,
  globalThreads,
  reloadThreads,
  resetNewThreadWorkspacePanels,
  resetProjectWorkspaceState,
  resetThreadWorkspacePanels,
  setActiveProjectId,
  setActiveView,
  setCurrentThread,
  setError,
  setProjects,
  threadsByProjectId,
}: DesktopNavigationOptions) {
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchValue, setSidebarSearchValue] = useState('');
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [forceExpandedProjectIds, setForceExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [selectingProjectDirectory, setSelectingProjectDirectory] = useState(false);
  const [projectActionMenuId, setProjectActionMenuId] = useState<string | null>(null);
  const [threadActionMenuId, setThreadActionMenuId] = useState<string | null>(null);
  const [renamingThread, setRenamingThread] = useState<RuntimeThreadSummary | null>(null);
  const [renameThreadTitle, setRenameThreadTitle] = useState('');
  const navigationRequests = useLatestRequestGuard();
  const currentProjectId = currentThread ? currentThread.projectId ?? null : activeProjectId;

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

  const startCurrentThread = useCallback(() => {
    navigationRequests.invalidate();
    setActiveView('chat');
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    resetNewThreadWorkspacePanels(activeProjectId);
    setCurrentThread(null);
    if (activeProjectId) {
      expandProject(activeProjectId);
    } else {
      setSessionsCollapsed(false);
      setActiveProjectId(null);
    }
  }, [activeProjectId, expandProject, navigationRequests, resetNewThreadWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread]);

  const startGlobalThread = useCallback(() => {
    navigationRequests.invalidate();
    setActiveView('chat');
    setSessionsCollapsed(false);
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    resetProjectWorkspaceState();
    resetNewThreadWorkspacePanels(null);
    setActiveProjectId(null);
    setCurrentThread(null);
  }, [navigationRequests, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const startProjectThread = useCallback(
    (projectId: string) => {
      navigationRequests.invalidate();
      setActiveView('chat');
      setThreadActionMenuId(null);
      setProjectActionMenuId(null);
      if (projectId !== currentProjectId) resetProjectWorkspaceState();
      resetNewThreadWorkspacePanels(projectId);
      setActiveProjectId(projectId);
      expandProject(projectId);
      setCurrentThread(null);
    },
    [currentProjectId, expandProject, navigationRequests, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
  );

  const selectThread = useCallback(
    async (threadId: string) => {
      const isLatest = navigationRequests.begin();
      setActiveView('chat');
      setThreadActionMenuId(null);
      const thread = await client.getThread(threadId);
      if (!isLatest()) return;
      const nextProjectId = thread.projectId ?? null;
      if (nextProjectId !== currentProjectId) resetProjectWorkspaceState();
      if (thread.projectId) {
        setActiveProjectId(thread.projectId);
        expandProject(thread.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(thread);
    },
    [client, currentProjectId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
  );

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

  const archiveThread = useCallback(
    async (thread: RuntimeThreadSummary) => {
      const isLatest = navigationRequests.begin();
      setThreadActionMenuId(null);
      await client.updateThread(thread.id, { archived: true });
      resetThreadWorkspacePanels(thread.id);
      const nextThreads = await reloadThreads();
      if (!isLatest()) return;
      if (currentThread?.id !== thread.id) return;
      const fallbackSummary =
        (thread.projectId ? nextThreads.find((item) => item.projectId === thread.projectId) : nextThreads.find((item) => !item.projectId)) ??
        nextThreads[0];
      if (!fallbackSummary) {
        setCurrentThread(null);
        return;
      }
      const fallback = await client.getThread(fallbackSummary.id);
      if (!isLatest()) return;
      const nextProjectId = fallback.projectId ?? null;
      if (nextProjectId !== (thread.projectId ?? null)) resetProjectWorkspaceState();
      if (fallback.projectId) {
        setActiveProjectId(fallback.projectId);
        expandProject(fallback.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(fallback);
    },
    [client, currentThread?.id, expandProject, navigationRequests, reloadThreads, resetProjectWorkspaceState, resetThreadWorkspacePanels, setActiveProjectId, setCurrentThread],
  );

  const selectProject = useCallback(
    async (project: WorkspaceProject) => {
      const isLatest = navigationRequests.begin();
      setActiveView('chat');
      if (project.id !== currentProjectId) resetProjectWorkspaceState();
      setActiveProjectId(project.id);
      expandProject(project.id);
      const projectThread = (threadsByProjectId.get(project.id) ?? [])[0];
      setCurrentThread(null);
      if (!projectThread) return;
      const thread = await client.getThread(projectThread.id);
      if (isLatest()) setCurrentThread(thread);
    },
    [client, currentProjectId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread, threadsByProjectId],
  );

  const enterChatMode = useCallback(async () => {
    const isLatest = navigationRequests.begin();
    setActiveView('chat');
    setSessionsCollapsed(false);
    setActiveProjectId(null);
    if (currentProjectId) resetProjectWorkspaceState();
    if (!currentThread?.projectId) return;
    const fallback = globalThreads[0];
    if (!fallback) {
      setCurrentThread(null);
      return;
    }
    const thread = await client.getThread(fallback.id);
    if (isLatest()) setCurrentThread(thread);
  }, [client, currentProjectId, currentThread?.projectId, globalThreads, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

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

  const selectProjectFromSidebar = useCallback(
    async (project: WorkspaceProject) => {
      if (project.id === activeProjectId) {
        toggleProjectCollapsed(project.id);
        return;
      }
      await selectProject(project);
    },
    [activeProjectId, selectProject, toggleProjectCollapsed],
  );

  const addProjectByPath = useCallback(
    async (pathValue: string) => {
      const inputPath = pathValue.trim();
      if (!inputPath) return;
      const project = await client.addProject({ path: inputPath });
      const list = await client.listProjects();
      setProjects(list.projects);
      setActiveProjectId(project.id);
      expandProject(project.id);
      resetProjectWorkspaceState();
      resetNewThreadWorkspacePanels(project.id);
    },
    [client, expandProject, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setProjects],
  );

  const selectProjectDirectory = useCallback(async () => {
    if (selectingProjectDirectory) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setError('Desktop directory picker is unavailable.');
      return;
    }
    setSelectingProjectDirectory(true);
    try {
      const selectedPath = await api.selectDirectory();
      if (selectedPath) await addProjectByPath(selectedPath);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSelectingProjectDirectory(false);
    }
  }, [addProjectByPath, selectingProjectDirectory, setError]);

  const hideProjectFromNavigation = useCallback(
    async (project: WorkspaceProject, persist: () => Promise<void>) => {
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
    },
    [client, currentThread?.projectId, expandProject, reloadThreads, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, resetThreadWorkspacePanels, setActiveProjectId, setCurrentThread, setProjects, threadsByProjectId],
  );

  const archiveProject = useCallback(
    async (project: WorkspaceProject) => {
      await hideProjectFromNavigation(project, () => client.archiveProject(project.id));
    },
    [client, hideProjectFromNavigation],
  );

  const removeProject = useCallback(
    async (project: WorkspaceProject) => {
      await hideProjectFromNavigation(project, () => client.removeProject(project.id));
    },
    [client, hideProjectFromNavigation],
  );

  return {
    addProjectByPath,
    archiveProject,
    archiveThread,
    closeNavigationMenus,
    closeRenameThread,
    collapsedProjectIds,
    enterChatMode,
    expandProject,
    forceExpandedProjectIds,
    openRenameThread,
    projectActionMenuId,
    projectsCollapsed,
    removeProject,
    renameThreadTitle,
    renamingThread,
    saveRenameThread,
    selectProjectDirectory,
    selectProjectFromSidebar,
    selectThread,
    selectingProjectDirectory,
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
  };
}

export type DesktopNavigationState = ReturnType<typeof useDesktopNavigation>;
