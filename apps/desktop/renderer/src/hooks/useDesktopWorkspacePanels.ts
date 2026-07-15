import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { clearTerminalRestoreBuffer } from '../components/workspace/TerminalPane.js';
import { readPreferredWorkspaceAppId, writePreferredWorkspaceAppId } from '../utils/workspaceAppPreference.js';
import { useLatestRequestGuard } from './useLatestRequestGuard.js';
import {
  activePanelInSlot,
  addPanelToSlotState,
  activatePanelInSlotState,
  createDefaultSidePanelSlot,
  createBrowserPanel,
  createEmptyPanelSlot,
  createFilePanel,
  createFilesPanel,
  createReviewPanel,
  createSideChatPanel as createSideChatPanelTab,
  createWorkspaceOverviewPanel,
  removePanelFromSlotState,
  reorderPanelInSlotState,
  slotHasPanelType,
  type DesktopPanelDropPlacement,
  type DesktopPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
  type DesktopPanelType,
  type DesktopReviewLoadOptions,
  type DesktopReviewState,
  type DesktopTerminalSession,
  type DesktopWorkspaceApp,
} from '../components/workspace/model.js';

type WorkspacePanelsOptions = {
  activeProject: WorkspaceProject | null | undefined;
  activeView: string;
  setError: (message: string | null) => void;
};

type TerminalSessionsByPanelId = Record<string, Record<string, DesktopTerminalSession>>;

const GLOBAL_TERMINAL_PROJECT_KEY = '__global__';

export function useDesktopWorkspacePanels({ activeProject, activeView, setError }: WorkspacePanelsOptions) {
  const [sidePanelSlot, setSidePanelSlot] = useState<DesktopPanelSlotState>(() => createEmptyPanelSlot());
  const [sidePanelExpanded, setSidePanelExpanded] = useState(false);
  const [bottomPanelSlot, setBottomPanelSlot] = useState<DesktopPanelSlotState>(() => createEmptyPanelSlot());
  const [terminalSessionsByPanelId, setTerminalSessionsByPanelId] = useState<TerminalSessionsByPanelId>({});
  const [workspaceAppMenuOpen, setWorkspaceAppMenuOpen] = useState(false);
  const [panelLauncherMenuOpen, setPanelLauncherMenuOpen] = useState(false);
  const [workspaceApps, setWorkspaceApps] = useState<DesktopWorkspaceApp[]>([]);
  const [selectedWorkspaceAppId, setSelectedWorkspaceAppId] = useState<string | null>(() => readPreferredWorkspaceAppId() || null);
  const [reviewState, setReviewState] = useState<DesktopReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pendingTerminalSessionKeysRef = useRef<Set<string>>(new Set());
  const terminalPanelSeqRef = useRef(0);
  const sideChatPanelSeqRef = useRef(0);
  const reviewRequests = useLatestRequestGuard();

  const selectedWorkspaceApp = workspaceApps.find((app) => app.id === selectedWorkspaceAppId) ?? workspaceApps[0] ?? null;
  const sideActivePanel = activePanelInSlot(sidePanelSlot);
  const bottomActivePanel = activePanelInSlot(bottomPanelSlot);
  const sidePanelVisible = activeView === 'chat' && sidePanelExpanded && Boolean(sideActivePanel);
  const bottomPanelVisible = activeView === 'chat' && Boolean(bottomActivePanel);
  const bottomTerminalPanelOpen = slotHasPanelType(bottomPanelSlot, 'terminal');
  const terminalProjectKey = activeProject?.id ?? GLOBAL_TERMINAL_PROJECT_KEY;
  const activeTerminalSessionsByPanelId = useMemo(() => {
    const sessions: Record<string, DesktopTerminalSession> = {};
    for (const [panelId, sessionsByProject] of Object.entries(terminalSessionsByPanelId)) {
      const session = sessionsByProject[terminalProjectKey];
      if (session) sessions[panelId] = session;
    }
    return sessions;
  }, [terminalProjectKey, terminalSessionsByPanelId]);

  const closeWorkspaceMenus = useCallback(() => {
    setWorkspaceAppMenuOpen(false);
    setPanelLauncherMenuOpen(false);
  }, []);

  const closeAllTerminalSessions = useCallback(() => {
    pendingTerminalSessionKeysRef.current.clear();
    setTerminalSessionsByPanelId((sessionsByPanel) => {
      for (const sessionsByProject of Object.values(sessionsByPanel)) {
        for (const session of Object.values(sessionsByProject)) {
          clearTerminalRestoreBuffer(session.sessionId);
          void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
        }
      }
      return {};
    });
  }, []);

  const closeTerminalSessionsForPanel = useCallback((panelId: string) => {
    for (const key of pendingTerminalSessionKeysRef.current) {
      if (key.startsWith(`${panelId}:`)) pendingTerminalSessionKeysRef.current.delete(key);
    }
    setTerminalSessionsByPanelId((sessionsByPanel) => {
      const sessionsByProject = sessionsByPanel[panelId];
      if (!sessionsByProject) return sessionsByPanel;
      for (const session of Object.values(sessionsByProject)) {
        clearTerminalRestoreBuffer(session.sessionId);
        void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
      }
      const next = { ...sessionsByPanel };
      delete next[panelId];
      return next;
    });
  }, []);

  const resetPanelSlots = useCallback(() => {
    closeAllTerminalSessions();
    setSidePanelExpanded(false);
    setSidePanelSlot(createEmptyPanelSlot());
    setBottomPanelSlot(createEmptyPanelSlot());
    closeWorkspaceMenus();
  }, [closeAllTerminalSessions, closeWorkspaceMenus]);

  const resetProjectBoundPanels = useCallback(() => {
    reviewRequests.invalidate();
    closeWorkspaceMenus();
    setReviewState(null);
    setReviewError(null);
    setReviewLoading(false);
    setSidePanelSlot(clearProjectBoundPanelsFromSlot);
    setBottomPanelSlot(clearProjectBoundPanelsFromSlot);
  }, [closeWorkspaceMenus, reviewRequests]);

  useEffect(() => {
    reviewRequests.invalidate();
    if (!activeProject?.path) {
      setWorkspaceApps([]);
      setSelectedWorkspaceAppId(null);
      setReviewState(null);
      setReviewError(null);
      setReviewLoading(false);
      return undefined;
    }
    let cancelled = false;
    window.setsunaDesktop?.workspaceApps
      .list(activeProject.path)
      .then((items) => {
        if (cancelled) return;
        setWorkspaceApps(items);
        setSelectedWorkspaceAppId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          const preferred = readPreferredWorkspaceAppId();
          if (preferred && items.some((item) => item.id === preferred)) return preferred;
          return items[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceApps([]);
        setSelectedWorkspaceAppId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.path, reviewRequests]);

  const loadReviewState = useCallback(async (options: DesktopReviewLoadOptions = {}) => {
    if (!activeProject?.path) {
      reviewRequests.invalidate();
      setReviewState(null);
      setReviewError(null);
      return;
    }
    const api = window.setsunaDesktop?.desktopReview;
    if (!api) {
      setReviewError('Desktop review bridge is unavailable.');
      return;
    }
    const isLatest = reviewRequests.begin();
    const projectPath = activeProject.path;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const state = await api.getState(projectPath, options);
      if (!isLatest()) return;
      setReviewState(state);
    } catch (unknownError) {
      if (!isLatest()) return;
      setReviewState(null);
      setReviewError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      if (isLatest()) setReviewLoading(false);
    }
  }, [activeProject?.path, reviewRequests]);

  useEffect(() => {
    if (activeView !== 'chat') return;
    if (!slotHasPanelType(sidePanelSlot, 'review') && !slotHasPanelType(bottomPanelSlot, 'review')) return;
    void loadReviewState();
  }, [activeView, bottomPanelSlot, loadReviewState, sidePanelSlot]);

  const createTerminalPanel = useCallback((): DesktopPanelTab => {
    terminalPanelSeqRef.current += 1;
    return {
      id: `terminal-${Date.now()}-${terminalPanelSeqRef.current}`,
      type: 'terminal',
      title: terminalPanelSeqRef.current === 1 ? '终端' : `终端 ${terminalPanelSeqRef.current}`,
    };
  }, []);

  const createSideChatPanel = useCallback((): DesktopPanelTab => {
    sideChatPanelSeqRef.current += 1;
    const sequence = sideChatPanelSeqRef.current;
    return createSideChatPanelTab(
      `side-chat-${Date.now()}-${sequence}`,
      sequence === 1 ? '侧边任务' : `侧边任务 ${sequence}`,
    );
  }, []);

  const openTerminalSessionForPanel = useCallback(
    async (panelId: string) => {
      const sessionKey = terminalSessionKey(panelId, terminalProjectKey);
      if (terminalSessionsByPanelId[panelId]?.[terminalProjectKey]) return;
      if (pendingTerminalSessionKeysRef.current.has(sessionKey)) return;
      const api = window.setsunaDesktop?.terminal;
      if (!api) {
        setError('Desktop terminal bridge is unavailable.');
        return;
      }
      pendingTerminalSessionKeysRef.current.add(sessionKey);
      try {
        const session = await api.open(activeProject?.path ?? null, 100, 24);
        if (!pendingTerminalSessionKeysRef.current.has(sessionKey)) {
          void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
          return;
        }
        setTerminalSessionsByPanelId((items) => {
          if (items[panelId]?.[terminalProjectKey]) {
            void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
            return items;
          }
          return {
            ...items,
            [panelId]: {
              ...(items[panelId] ?? {}),
              [terminalProjectKey]: session,
            },
          };
        });
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      } finally {
        pendingTerminalSessionKeysRef.current.delete(sessionKey);
      }
    },
    [activeProject?.path, setError, terminalProjectKey, terminalSessionsByPanelId],
  );

  const openDesktopPanel = useCallback(
    (slot: DesktopPanelSlot, type: DesktopPanelType) => {
      if ((type === 'browser' || type === 'chat') && slot !== 'side') return;
      if (type === 'review' && !activeProject) return;
      if ((type === 'files' || type === 'file') && !activeProject?.path) return;
      if (type === 'file') return;
      const panel =
        type === 'browser'
          ? createBrowserPanel()
          : type === 'chat'
          ? createSideChatPanel()
          : type === 'overview'
            ? createWorkspaceOverviewPanel()
            : type === 'review'
              ? createReviewPanel()
              : type === 'files'
                ? createFilesPanel()
                : createTerminalPanel();
      const updater = (current: DesktopPanelSlotState) => addPanelToSlotState(current, panel);
      if (slot === 'side') {
        setSidePanelExpanded(true);
        setSidePanelSlot(updater);
        return;
      }
      setBottomPanelSlot(updater);
    },
    [activeProject, createSideChatPanel, createTerminalPanel],
  );

  const openFilePanel = useCallback((filePath: string) => {
    closeWorkspaceMenus();
    setSidePanelExpanded(true);
    setSidePanelSlot((current) => addPanelToSlotState(current, createFilePanel(filePath)));
  }, [closeWorkspaceMenus]);

  const activateDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string) => {
    const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, panelId);
    if (slot === 'side') {
      setSidePanelExpanded(true);
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelSlot(updater);
  }, []);

  const reorderDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => {
    const updater = (current: DesktopPanelSlotState) => reorderPanelInSlotState(current, panelId, targetPanelId, placement);
    if (slot === 'side') {
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelSlot(updater);
  }, []);

  const closeDesktopPanelItem = useCallback(
    (slot: DesktopPanelSlot, panelId: string) => {
      const slotState = slot === 'side' ? sidePanelSlot : bottomPanelSlot;
      const panel = slotState.panels.find((item) => item.id === panelId);
      if (panel?.type === 'terminal') closeTerminalSessionsForPanel(panel.id);
      const updater = (current: DesktopPanelSlotState) => removePanelFromSlotState(current, panelId);
      if (slot === 'side') {
        setSidePanelSlot(updater);
        return;
      }
      setBottomPanelSlot(updater);
    },
    [bottomPanelSlot, closeTerminalSessionsForPanel, sidePanelSlot],
  );

  const closeDesktopPanelSlot = useCallback(
    (slot: DesktopPanelSlot) => {
      const slotState = slot === 'side' ? sidePanelSlot : bottomPanelSlot;
      slotState.panels.filter((panel) => panel.type === 'terminal').forEach((panel) => closeTerminalSessionsForPanel(panel.id));
      if (slot === 'side') {
        setSidePanelExpanded(false);
        setSidePanelSlot(createEmptyPanelSlot());
        return;
      }
      setBottomPanelSlot(createEmptyPanelSlot());
    },
    [bottomPanelSlot, closeTerminalSessionsForPanel, sidePanelSlot],
  );

  const toggleSidePanel = useCallback(() => {
    if (sidePanelExpanded && sidePanelSlot.active) {
      setSidePanelExpanded(false);
      closeWorkspaceMenus();
      return;
    }
    if (!sidePanelSlot.active) setSidePanelSlot(createDefaultSidePanelSlot());
    setSidePanelExpanded(true);
  }, [closeWorkspaceMenus, sidePanelExpanded, sidePanelSlot.active]);

  const toggleBottomTerminal = useCallback(() => {
    const terminalPanel = bottomPanelSlot.panels.find((panel) => panel.type === 'terminal');
    if (terminalPanel && bottomPanelSlot.active === terminalPanel.id) {
      closeDesktopPanelItem('bottom', terminalPanel.id);
      return;
    }
    if (terminalPanel) {
      activateDesktopPanel('bottom', terminalPanel.id);
      return;
    }
    setBottomPanelSlot((current) => addPanelToSlotState(current, createTerminalPanel()));
  }, [activateDesktopPanel, bottomPanelSlot, closeDesktopPanelItem, createTerminalPanel]);

  useEffect(() => {
    [sideActivePanel, bottomActivePanel]
      .filter((panel): panel is DesktopPanelTab => panel?.type === 'terminal')
      .forEach((panel) => void openTerminalSessionForPanel(panel.id));
  }, [bottomActivePanel, openTerminalSessionForPanel, sideActivePanel]);

  const openFileInWorkspaceApp = useCallback(
    async (filePath?: string | null, line?: number) => {
      if (!activeProject?.path || !selectedWorkspaceApp) return;
      try {
        await window.setsunaDesktop?.workspaceApps.open(activeProject.path, selectedWorkspaceApp.id, filePath ?? null, line ?? null);
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    },
    [activeProject?.path, selectedWorkspaceApp, setError],
  );

  const openSelectedWorkspaceApp = useCallback(async () => {
    await openFileInWorkspaceApp(null);
  }, [openFileInWorkspaceApp]);

  const toggleWorkspaceAppMenu = useCallback(() => {
    setPanelLauncherMenuOpen(false);
    setWorkspaceAppMenuOpen((value) => !value);
  }, []);

  const togglePanelLauncherMenu = useCallback(() => {
    setWorkspaceAppMenuOpen(false);
    setPanelLauncherMenuOpen((value) => !value);
  }, []);

  const selectWorkspaceApp = useCallback(
    (app: DesktopWorkspaceApp) => {
      setSelectedWorkspaceAppId(app.id);
      writePreferredWorkspaceAppId(app.id);
      closeWorkspaceMenus();
    },
    [closeWorkspaceMenus],
  );

  return useMemo(
    () => ({
      activateDesktopPanel,
      bottomActivePanel,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelOpen,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      loadReviewState,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFilePanel,
      openSelectedWorkspaceApp,
      panelLauncherMenuOpen,
      resetProjectBoundPanels,
      resetPanelSlots,
      reviewError,
      reviewLoading,
      reviewState,
      reorderDesktopPanel,
      selectWorkspaceApp,
      selectedWorkspaceApp,
      sideActivePanel,
      sidePanelSlot,
      sidePanelVisible,
      terminalSessionsByPanelId: activeTerminalSessionsByPanelId,
      toggleBottomTerminal,
      togglePanelLauncherMenu,
      toggleSidePanel,
      toggleWorkspaceAppMenu,
      workspaceAppMenuOpen,
      workspaceApps,
    }),
    [
      activateDesktopPanel,
      bottomActivePanel,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelOpen,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      loadReviewState,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFilePanel,
      openSelectedWorkspaceApp,
      panelLauncherMenuOpen,
      resetProjectBoundPanels,
      resetPanelSlots,
      reviewError,
      reviewLoading,
      reviewState,
      reorderDesktopPanel,
      selectWorkspaceApp,
      selectedWorkspaceApp,
      sideActivePanel,
      sidePanelSlot,
      sidePanelVisible,
      activeTerminalSessionsByPanelId,
      toggleBottomTerminal,
      togglePanelLauncherMenu,
      toggleSidePanel,
      toggleWorkspaceAppMenu,
      workspaceAppMenuOpen,
      workspaceApps,
    ],
  );
}

function terminalSessionKey(panelId: string, projectKey: string): string {
  return `${panelId}:${projectKey}`;
}

function clearProjectBoundPanelsFromSlot(slot: DesktopPanelSlotState): DesktopPanelSlotState {
  const panels = slot.panels.filter((panel) => panel.type === 'browser' || panel.type === 'terminal');
  const active = panels.some((panel) => panel.id === slot.active) ? slot.active : panels[0]?.id ?? null;
  if (panels.length === slot.panels.length && active === slot.active) return slot;
  return { active, panels };
}

export type DesktopWorkspacePanelsState = ReturnType<typeof useDesktopWorkspacePanels>;
