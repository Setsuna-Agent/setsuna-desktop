import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { clearTerminalRestoreBuffer } from '../components/workspace/TerminalPane.js';
import { readPreferredWorkspaceAppId, writePreferredWorkspaceAppId } from '../utils/workspaceAppPreference.js';
import {
  activePanelInSlot,
  addPanelToSlotState,
  activatePanelInSlotState,
  createDefaultSidePanelSlot,
  createEmptyPanelSlot,
  createFilePanel,
  createFilesPanel,
  createReviewPanel,
  removePanelFromSlotState,
  slotHasPanelType,
  type DesktopPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
  type DesktopPanelType,
  type DesktopReviewState,
  type DesktopTerminalSession,
  type DesktopWorkspaceApp,
} from '../components/workspace/model.js';

type WorkspacePanelsOptions = {
  activeProject: WorkspaceProject | null | undefined;
  activeView: string;
  setError: (message: string | null) => void;
};

export function useDesktopWorkspacePanels({ activeProject, activeView, setError }: WorkspacePanelsOptions) {
  const [sidePanelSlot, setSidePanelSlot] = useState<DesktopPanelSlotState>(() => createEmptyPanelSlot());
  const [bottomPanelSlot, setBottomPanelSlot] = useState<DesktopPanelSlotState>(() => createEmptyPanelSlot());
  const [terminalSessionsByPanelId, setTerminalSessionsByPanelId] = useState<Record<string, DesktopTerminalSession>>({});
  const [workspaceAppMenuOpen, setWorkspaceAppMenuOpen] = useState(false);
  const [panelLauncherMenuOpen, setPanelLauncherMenuOpen] = useState(false);
  const [workspaceApps, setWorkspaceApps] = useState<DesktopWorkspaceApp[]>([]);
  const [selectedWorkspaceAppId, setSelectedWorkspaceAppId] = useState<string | null>(() => readPreferredWorkspaceAppId() || null);
  const [reviewState, setReviewState] = useState<DesktopReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const terminalPanelSeqRef = useRef(0);

  const selectedWorkspaceApp = workspaceApps.find((app) => app.id === selectedWorkspaceAppId) ?? workspaceApps[0] ?? null;
  const sideActivePanel = activePanelInSlot(sidePanelSlot);
  const bottomActivePanel = activePanelInSlot(bottomPanelSlot);
  const sidePanelVisible = activeView === 'chat' && Boolean(sideActivePanel);
  const bottomPanelVisible = activeView === 'chat' && Boolean(bottomActivePanel);
  const bottomTerminalPanelOpen = slotHasPanelType(bottomPanelSlot, 'terminal');

  const closeWorkspaceMenus = useCallback(() => {
    setWorkspaceAppMenuOpen(false);
    setPanelLauncherMenuOpen(false);
  }, []);

  const closeAllTerminalSessions = useCallback(() => {
    setTerminalSessionsByPanelId((sessions) => {
      for (const session of Object.values(sessions)) {
        clearTerminalRestoreBuffer(session.sessionId);
        void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
      }
      return {};
    });
  }, []);

  const resetPanelSlots = useCallback(() => {
    closeAllTerminalSessions();
    setSidePanelSlot(createEmptyPanelSlot());
    setBottomPanelSlot(createEmptyPanelSlot());
    closeWorkspaceMenus();
  }, [closeAllTerminalSessions, closeWorkspaceMenus]);

  useEffect(() => {
    if (!activeProject?.path) {
      setWorkspaceApps([]);
      setSelectedWorkspaceAppId(null);
      setReviewState(null);
      setReviewError(null);
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
  }, [activeProject?.path]);

  const loadReviewState = useCallback(async () => {
    if (!activeProject?.path) {
      setReviewState(null);
      setReviewError(null);
      return;
    }
    const api = window.setsunaDesktop?.desktopReview;
    if (!api) {
      setReviewError('Desktop review bridge is unavailable.');
      return;
    }
    setReviewLoading(true);
    setReviewError(null);
    try {
      const state = await api.getState(activeProject.path);
      setReviewState(state);
    } catch (unknownError) {
      setReviewState(null);
      setReviewError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setReviewLoading(false);
    }
  }, [activeProject?.path]);

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

  const openTerminalSessionForPanel = useCallback(
    async (panelId: string) => {
      if (terminalSessionsByPanelId[panelId]) return;
      const api = window.setsunaDesktop?.terminal;
      if (!api) {
        setError('Desktop terminal bridge is unavailable.');
        return;
      }
      const session = await api.open(activeProject?.path ?? null, 100, 24);
      setTerminalSessionsByPanelId((items) => ({ ...items, [panelId]: session }));
    },
    [activeProject?.path, setError, terminalSessionsByPanelId],
  );

  const closeTerminalSessionForPanel = useCallback(
    (panelId: string) => {
      const session = terminalSessionsByPanelId[panelId];
      if (!session) return;
      clearTerminalRestoreBuffer(session.sessionId);
      void window.setsunaDesktop?.terminal.close(session.sessionId).catch(() => undefined);
      setTerminalSessionsByPanelId((items) => {
        const next = { ...items };
        delete next[panelId];
        return next;
      });
    },
    [terminalSessionsByPanelId],
  );

  const openDesktopPanel = useCallback(
    (slot: DesktopPanelSlot, type: DesktopPanelType) => {
      if (type === 'review' && !activeProject) return;
      if ((type === 'files' || type === 'file') && !activeProject?.path) return;
      const panel = type === 'review' ? createReviewPanel() : type === 'files' ? createFilesPanel() : createTerminalPanel();
      const updater = (current: DesktopPanelSlotState) => addPanelToSlotState(current, panel);
      if (slot === 'side') {
        setSidePanelSlot(updater);
        return;
      }
      setBottomPanelSlot(updater);
    },
    [activeProject, createTerminalPanel],
  );

  const openFilePanel = useCallback((filePath: string) => {
    closeWorkspaceMenus();
    setSidePanelSlot((current) => addPanelToSlotState(current, createFilePanel(filePath)));
  }, [closeWorkspaceMenus]);

  const activateDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string) => {
    const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, panelId);
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
      if (panel?.type === 'terminal') closeTerminalSessionForPanel(panel.id);
      const updater = (current: DesktopPanelSlotState) => removePanelFromSlotState(current, panelId);
      if (slot === 'side') {
        setSidePanelSlot(updater);
        return;
      }
      setBottomPanelSlot(updater);
    },
    [bottomPanelSlot, closeTerminalSessionForPanel, sidePanelSlot],
  );

  const closeDesktopPanelSlot = useCallback(
    (slot: DesktopPanelSlot) => {
      const slotState = slot === 'side' ? sidePanelSlot : bottomPanelSlot;
      slotState.panels.filter((panel) => panel.type === 'terminal').forEach((panel) => closeTerminalSessionForPanel(panel.id));
      if (slot === 'side') {
        setSidePanelSlot(createEmptyPanelSlot());
        return;
      }
      setBottomPanelSlot(createEmptyPanelSlot());
    },
    [bottomPanelSlot, closeTerminalSessionForPanel, sidePanelSlot],
  );

  const toggleSidePanel = useCallback(() => {
    if (sidePanelSlot.active) {
      closeDesktopPanelSlot('side');
      return;
    }
    setSidePanelSlot(createDefaultSidePanelSlot());
  }, [closeDesktopPanelSlot, sidePanelSlot.active]);

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
    const activeTerminalPanel = [sideActivePanel, bottomActivePanel].find((panel) => panel?.type === 'terminal');
    if (activeTerminalPanel) void openTerminalSessionForPanel(activeTerminalPanel.id);
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
      resetPanelSlots,
      reviewError,
      reviewLoading,
      reviewState,
      selectWorkspaceApp,
      selectedWorkspaceApp,
      sideActivePanel,
      sidePanelSlot,
      sidePanelVisible,
      terminalSessionsByPanelId,
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
      resetPanelSlots,
      reviewError,
      reviewLoading,
      reviewState,
      selectWorkspaceApp,
      selectedWorkspaceApp,
      sideActivePanel,
      sidePanelSlot,
      sidePanelVisible,
      terminalSessionsByPanelId,
      toggleBottomTerminal,
      togglePanelLauncherMenu,
      toggleSidePanel,
      toggleWorkspaceAppMenu,
      workspaceAppMenuOpen,
      workspaceApps,
    ],
  );
}

export type DesktopWorkspacePanelsState = ReturnType<typeof useDesktopWorkspacePanels>;
