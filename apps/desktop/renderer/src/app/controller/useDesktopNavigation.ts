import type {
  DesktopRuntimeClient,
  RuntimeThread,
  RuntimeThreadSummary,
  UpdateWorkspaceProjectInput,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import type { MainView } from '../types.js';

type DesktopNavigationOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  confirmDiscardProjectFile: () => boolean;
  currentThread: RuntimeThread | null;
  globalThreads: RuntimeThreadSummary[];
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
  client,
  confirmDiscardProjectFile,
  currentThread,
  globalThreads,
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
    if (!confirmDiscardProjectFile()) return;
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
  }, [activeProjectId, confirmDiscardProjectFile, expandProject, navigationRequests, resetNewThreadWorkspacePanels, setActiveProjectId, setActiveView, setCurrentThread]);

  const startGlobalThread = useCallback(() => {
    if (!confirmDiscardProjectFile()) return;
    navigationRequests.invalidate();
    setActiveView('chat');
    setSessionsCollapsed(false);
    setThreadActionMenuId(null);
    setProjectActionMenuId(null);
    resetProjectWorkspaceState();
    resetNewThreadWorkspacePanels(null);
    setActiveProjectId(null);
    setCurrentThread(null);
  }, [confirmDiscardProjectFile, navigationRequests, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

  const startProjectThread = useCallback(
    (projectId: string) => {
      if (!confirmDiscardProjectFile()) return;
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
    [confirmDiscardProjectFile, currentProjectId, expandProject, navigationRequests, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
  );

  const selectThread = useCallback(
    async (threadId: string) => {
      if (!confirmDiscardProjectFile()) return;
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
    [client, confirmDiscardProjectFile, currentProjectId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread],
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
      if (currentThread?.id === thread.id && !confirmDiscardProjectFile()) return;
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
    [client, confirmDiscardProjectFile, currentThread?.id, expandProject, navigationRequests, reloadThreads, resetProjectWorkspaceState, resetThreadWorkspacePanels, setActiveProjectId, setCurrentThread],
  );

  const selectProject = useCallback(
    async (project: WorkspaceProject) => {
      if (project.id !== currentProjectId && !confirmDiscardProjectFile()) return;
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
    [client, confirmDiscardProjectFile, currentProjectId, expandProject, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread, threadsByProjectId],
  );

  const enterChatMode = useCallback(async () => {
    if (!confirmDiscardProjectFile()) return;
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
  }, [client, confirmDiscardProjectFile, currentProjectId, currentThread?.projectId, globalThreads, navigationRequests, resetProjectWorkspaceState, setActiveProjectId, setActiveView, setCurrentThread]);

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
    if (changesCurrentWorkspace && !confirmDiscardProjectFile()) {
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
      setActiveProjectId(project.id);
      expandProject(project.id);
      resetNewThreadWorkspacePanels(project.id);
    }
    if (changesCurrentWorkspace) resetProjectWorkspaceState();
    return true;
  }, [client, confirmDiscardProjectFile, currentProjectId, expandProject, projectEditor, resetNewThreadWorkspacePanels, resetProjectWorkspaceState, setActiveProjectId, setProjects]);

  const hideProjectFromNavigation = useCallback(
    async (project: WorkspaceProject, persist: () => Promise<void>) => {
      if (!confirmDiscardProjectFile()) return false;
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
    selectProjectFromSidebar,
    selectThread,
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
