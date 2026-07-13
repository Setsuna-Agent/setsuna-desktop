import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { DesktopRuntimeClient, RuntimeThread, RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { MainView } from '../types/app.js';

type DesktopNavigationOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  currentThread: RuntimeThread | null;
  globalThreads: RuntimeThreadSummary[];
  reloadThreads: () => Promise<RuntimeThreadSummary[]>;
  resetProjectWorkspacePanels: () => void;
  resetWorkspacePanels: () => void;
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
  resetProjectWorkspacePanels,
  resetWorkspacePanels,
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
    setActiveView('chat');
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    setCurrentThread(null);
    if (activeProjectId) {
      expandProject(activeProjectId);
    } else {
      setSessionsCollapsed(false);
      setActiveProjectId(null);
    }
  }, [activeProjectId, expandProject, setActiveProjectId, setActiveView, setCurrentThread]);

  const startGlobalThread = useCallback(() => {
    setActiveView('chat');
    setSessionsCollapsed(false);
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    setActiveProjectId(null);
    setCurrentThread(null);
    resetWorkspacePanels();
  }, [resetWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread]);

  const startProjectThread = useCallback(
    (projectId: string) => {
      setActiveView('chat');
      setThreadActionMenuId(null);
      setProjectActionMenuId(null);
      if (projectId !== currentProjectId) resetProjectWorkspacePanels();
      setActiveProjectId(projectId);
      expandProject(projectId);
      setCurrentThread(null);
    },
    [currentProjectId, expandProject, resetProjectWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread],
  );

  const selectThread = useCallback(
    async (threadId: string) => {
      setActiveView('chat');
      setThreadActionMenuId(null);
      const thread = await client.getThread(threadId);
      const nextProjectId = thread.projectId ?? null;
      if (nextProjectId !== currentProjectId) resetProjectWorkspacePanels();
      if (thread.projectId) {
        setActiveProjectId(thread.projectId);
        expandProject(thread.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(thread);
    },
    [client, currentProjectId, expandProject, resetProjectWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread],
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
      setThreadActionMenuId(null);
      await client.updateThread(thread.id, { archived: true });
      const nextThreads = await reloadThreads();
      if (currentThread?.id !== thread.id) return;
      const fallbackSummary =
        (thread.projectId ? nextThreads.find((item) => item.projectId === thread.projectId) : nextThreads.find((item) => !item.projectId)) ??
        nextThreads[0];
      if (!fallbackSummary) {
        setCurrentThread(null);
        return;
      }
      const fallback = await client.getThread(fallbackSummary.id);
      const nextProjectId = fallback.projectId ?? null;
      if (nextProjectId !== (thread.projectId ?? null)) resetProjectWorkspacePanels();
      if (fallback.projectId) {
        setActiveProjectId(fallback.projectId);
        expandProject(fallback.projectId);
      } else {
        setActiveProjectId(null);
      }
      setCurrentThread(fallback);
    },
    [client, currentThread?.id, expandProject, reloadThreads, resetProjectWorkspacePanels, setActiveProjectId, setCurrentThread],
  );

  const selectProject = useCallback(
    async (project: WorkspaceProject) => {
      setActiveView('chat');
      if (project.id !== currentProjectId) resetProjectWorkspacePanels();
      setActiveProjectId(project.id);
      expandProject(project.id);
      const projectThread = (threadsByProjectId.get(project.id) ?? [])[0];
      setCurrentThread(projectThread ? await client.getThread(projectThread.id) : null);
    },
    [client, currentProjectId, expandProject, resetProjectWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread, threadsByProjectId],
  );

  const enterChatMode = useCallback(async () => {
    setActiveView('chat');
    setSessionsCollapsed(false);
    setActiveProjectId(null);
    if (currentProjectId) resetProjectWorkspacePanels();
    if (!currentThread?.projectId) return;
    const fallback = globalThreads[0];
    setCurrentThread(fallback ? await client.getThread(fallback.id) : null);
  }, [client, currentProjectId, currentThread?.projectId, globalThreads, resetProjectWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread]);

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
      resetWorkspacePanels();
    },
    [client, expandProject, resetWorkspacePanels, setActiveProjectId, setProjects],
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
      resetWorkspacePanels();
    },
    [client, currentThread?.projectId, expandProject, reloadThreads, resetWorkspacePanels, setActiveProjectId, setCurrentThread, setProjects],
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
