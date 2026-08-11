import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  chatComposerTargetIdentity,
  type ChatComposerTargetIdentity,
} from '../../chat/hooks/useChatComposerSession.js';
import { clearTerminalRestoreBuffer } from '../terminalRestoreBuffer.js';
import {
  activatePanelInSlotState,
  activePanelInSlot,
  addPanelToSlotState,
  createBrowserPanel,
  createConversationDebugPanel,
  createDefaultSidePanelSlot,
  createEmptyPanelSlot,
  createFilePanel,
  createFilesPanel,
  createReviewPanel,
  createSideChatPanel as createSideChatPanelTab,
  createWorkspaceOverviewPanel,
  fileWorkspacePanelTargetSlot,
  findDesktopPanelLocationByType,
  movePanelBetweenSlotStates,
  removePanelFromSlotState,
  reorderPanelInSlotState,
  slotHasPanelType,
  updatePanelInSlotState,
  type DesktopPanelDropPlacement,
  type DesktopPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
  type DesktopPanelTabPatch,
  type DesktopPanelType,
  type DesktopReviewLoadOptions,
  type DesktopReviewState,
  type DesktopTerminalSession,
  type DesktopWorkspaceApp,
} from '../model.js';
import { readPreferredWorkspaceAppId, writePreferredWorkspaceAppId } from '../model/workspaceAppPreference.js';
import { shouldLoadDesktopReviewState } from './desktopReviewAutoLoad.js';
import {
  desktopWorkspaceBrowserPanelInstances,
  useDesktopWorkspacePanelSession,
  type DesktopWorkspaceBrowserPanelInstance,
  type DesktopWorkspacePanelLayout,
} from './useDesktopWorkspacePanelSession.js';
import { readyThreadWorkspacePath, type ThreadWorkspaceStatus } from './useThreadWorkspace.js';

type WorkspacePanelsOptions = {
  activeProject: WorkspaceProject | null | undefined;
  activeView: string;
  autoLoadReview: boolean;
  developerFeaturesEnabled: boolean | null;
  setError: (message: string | null) => void;
  targetIdentity: ChatComposerTargetIdentity;
  workspaceStatus: ThreadWorkspaceStatus;
};

type TerminalSessionsByPanelId = Record<string, Record<string, DesktopTerminalSession>>;
const GLOBAL_TERMINAL_PROJECT_KEY = '__global__';

export function useDesktopWorkspacePanels({
  activeProject,
  activeView,
  autoLoadReview,
  developerFeaturesEnabled,
  setError,
  targetIdentity,
  workspaceStatus,
}: WorkspacePanelsOptions) {
  const { t } = useI18n();
  const {
    bottomPanelSlot,
    claimForThread,
    layoutForIdentity,
    layouts,
    resetForIdentity,
    setBottomPanelSlot,
    setSidePanelExpanded,
    setSidePanelSlot,
    sidePanelExpanded,
    sidePanelSlot,
    updateLayoutForIdentity,
  } = useDesktopWorkspacePanelSession(targetIdentity);
  // These dispatchers are scoped to targetIdentity, so callbacks using them must
  // include them in their dependency list instead of treating them like useState setters.
  const [terminalSessionsByPanelId, setTerminalSessionsByPanelId] = useState<TerminalSessionsByPanelId>({});
  const [workspaceAppMenuOpen, setWorkspaceAppMenuOpen] = useState(false);
  const [panelLauncherMenuOpen, setPanelLauncherMenuOpen] = useState(false);
  const [workspaceApps, setWorkspaceApps] = useState<DesktopWorkspaceApp[]>([]);
  const [selectedWorkspaceAppId, setSelectedWorkspaceAppId] = useState<string | null>(() => readPreferredWorkspaceAppId() || null);
  const [reviewState, setReviewState] = useState<DesktopReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pendingTerminalSessionKeysRef = useRef<Set<string>>(new Set());
  const browserPanelSeqRef = useRef(0);
  const terminalPanelSeqRef = useRef(0);
  const sideChatPanelSeqRef = useRef(0);
  const reviewRequests = useLatestRequestGuard();

  const selectedWorkspaceApp = workspaceApps.find((app) => app.id === selectedWorkspaceAppId) ?? workspaceApps[0] ?? null;
  const sideActivePanel = activePanelInSlot(sidePanelSlot);
  const bottomActivePanel = activePanelInSlot(bottomPanelSlot);
  const sidePanelVisible = activeView === 'chat' && sidePanelExpanded && Boolean(sideActivePanel);
  const bottomPanelVisible = activeView === 'chat' && Boolean(bottomActivePanel);
  const bottomTerminalPanelActive = bottomPanelVisible && bottomActivePanel?.type === 'terminal';
  const browserPanelInstances = useMemo(
    () => desktopWorkspaceBrowserPanelInstances(layouts, targetIdentity, {
      bottomVisible: bottomPanelVisible,
      sideVisible: sidePanelVisible,
    }),
    [bottomPanelVisible, layouts, sidePanelVisible, targetIdentity],
  );
  const bottomTerminalPanelOpen = slotHasPanelType(bottomPanelSlot, 'terminal');
  const sideReviewPanelOpen = slotHasPanelType(sidePanelSlot, 'review');
  const bottomReviewPanelOpen = slotHasPanelType(bottomPanelSlot, 'review');
  const panelLauncherTypes = useMemo(() => [
    'chat',
    'browser',
    developerFeaturesEnabled === true
      && !slotHasPanelType(sidePanelSlot, 'conversation-debug')
      && !slotHasPanelType(bottomPanelSlot, 'conversation-debug')
      ? 'conversation-debug'
      : null,
    activeProject
      && !slotHasPanelType(sidePanelSlot, 'review')
      && !slotHasPanelType(bottomPanelSlot, 'review')
      ? 'review'
      : null,
    activeProject?.path
      && !slotHasPanelType(sidePanelSlot, 'files')
      && !slotHasPanelType(bottomPanelSlot, 'files')
      ? 'files'
      : null,
    'terminal',
  ].filter(Boolean) as DesktopPanelType[], [activeProject, bottomPanelSlot, developerFeaturesEnabled, sidePanelSlot]);
  const terminalProjectKey = activeProject?.id ?? GLOBAL_TERMINAL_PROJECT_KEY;
  const terminalWorkspacePath = readyThreadWorkspacePath(activeProject, workspaceStatus);
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

  const closeTerminalSessionsForLayout = useCallback((layout: DesktopWorkspacePanelLayout) => {
    [...layout.sidePanelSlot.panels, ...layout.bottomPanelSlot.panels]
      .filter((panel) => panel.type === 'terminal')
      .forEach((panel) => closeTerminalSessionsForPanel(panel.id));
  }, [closeTerminalSessionsForPanel]);

  const resetPanelSession = useCallback((identity: ChatComposerTargetIdentity) => {
    closeTerminalSessionsForLayout(layoutForIdentity(identity));
    resetForIdentity(identity);
    if (identity === targetIdentity) closeWorkspaceMenus();
  }, [closeTerminalSessionsForLayout, closeWorkspaceMenus, layoutForIdentity, resetForIdentity, targetIdentity]);

  const resetNewThreadPanelSession = useCallback((projectId: string | null) => {
    resetPanelSession(chatComposerTargetIdentity(null, projectId));
    closeWorkspaceMenus();
  }, [closeWorkspaceMenus, resetPanelSession]);

  const resetThreadPanelSession = useCallback((threadId: string) => {
    resetPanelSession(chatComposerTargetIdentity(threadId, null));
  }, [resetPanelSession]);

  useEffect(() => {
    reviewRequests.invalidate();
    setReviewState(null);
    setReviewError(null);
    setReviewLoading(false);
    if (!activeProject?.path) {
      setWorkspaceApps([]);
      setSelectedWorkspaceAppId(null);
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
      setReviewLoading(false);
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
    if (!shouldLoadDesktopReviewState({
      activeView,
      autoLoad: autoLoadReview,
      error: reviewError,
      hasState: Boolean(reviewState),
      hasWorkspace: Boolean(activeProject?.path),
      loading: reviewLoading,
      panelOpen: sideReviewPanelOpen || bottomReviewPanelOpen,
    })) return;
    void loadReviewState();
  }, [activeProject?.path, activeView, autoLoadReview, bottomReviewPanelOpen, loadReviewState, reviewError, reviewLoading, reviewState, sideReviewPanelOpen]);

  const createTerminalPanel = useCallback((): DesktopPanelTab => {
    terminalPanelSeqRef.current += 1;
    return {
      id: `terminal-${Date.now()}-${terminalPanelSeqRef.current}`,
      type: 'terminal',
      title: t('workspace.panel.terminal'),
    };
  }, [t]);

  const createChatPanel = useCallback((): DesktopPanelTab => {
    sideChatPanelSeqRef.current += 1;
    const sequence = sideChatPanelSeqRef.current;
    return createSideChatPanelTab(
      `side-chat-${Date.now()}-${sequence}`,
      sequence === 1
        ? t('workspace.panel.sideChat')
        : t('workspace.panels.sideChatNumbered', { sequence }),
    );
  }, [t]);

  const createBrowserPanelTab = useCallback((url?: string): DesktopPanelTab => {
    browserPanelSeqRef.current += 1;
    return createBrowserPanel(`browser-${Date.now()}-${browserPanelSeqRef.current}`, url);
  }, []);

  const addPanelToDesktopSlot = useCallback((slot: DesktopPanelSlot, panel: DesktopPanelTab) => {
    const updater = (current: DesktopPanelSlotState) => addPanelToSlotState(current, panel);
    if (slot === 'side') {
      setSidePanelExpanded(true);
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelSlot(updater);
  }, [setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot]);

  const openBrowserPanel = useCallback((url?: string, slot: DesktopPanelSlot = 'side') => {
    closeWorkspaceMenus();
    addPanelToDesktopSlot(slot, createBrowserPanelTab(url));
  }, [addPanelToDesktopSlot, closeWorkspaceMenus, createBrowserPanelTab]);

  const openTerminalSessionForPanel = useCallback(
    async (panelId: string) => {
      // Loading/error/empty states must never fall back to terminal.open(null), which starts in the user home directory.
      if (!terminalWorkspacePath) return;
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
        const session = await api.open(terminalWorkspacePath, 100, 24);
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
    [setError, terminalProjectKey, terminalSessionsByPanelId, terminalWorkspacePath],
  );

  const openDesktopPanel = useCallback(
    (slot: DesktopPanelSlot, type: DesktopPanelType) => {
      if (type === 'file') return;
      if (type === 'conversation-debug' && developerFeaturesEnabled !== true) return;
      if (type === 'review' && !activeProject) return;
      if (type === 'files' && !activeProject?.path) return;
      closeWorkspaceMenus();
      if (isSingletonDesktopPanelType(type)) {
        const existing = findDesktopPanelLocationByType(sidePanelSlot, bottomPanelSlot, type);
        if (existing) {
          const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, existing.panelId);
          if (existing.slot === 'side') {
            setSidePanelExpanded(true);
            setSidePanelSlot(updater);
          } else {
            setBottomPanelSlot(updater);
          }
          return;
        }
      }
      const panel =
        type === 'browser'
          ? createBrowserPanelTab()
          : type === 'chat'
            ? createChatPanel()
            : type === 'conversation-debug'
              ? createConversationDebugPanel()
              : type === 'overview'
                ? createWorkspaceOverviewPanel()
                : type === 'review'
                  ? createReviewPanel()
                  : type === 'files'
                    ? createFilesPanel()
                    : createTerminalPanel();
      addPanelToDesktopSlot(
        type === 'files'
          ? fileWorkspacePanelTargetSlot(slot, sidePanelSlot, bottomPanelSlot)
          : slot,
        panel,
      );
    },
    [
      activeProject,
      addPanelToDesktopSlot,
      bottomPanelSlot,
      closeWorkspaceMenus,
      createBrowserPanelTab,
      createChatPanel,
      createTerminalPanel,
      developerFeaturesEnabled,
      setBottomPanelSlot,
      setSidePanelExpanded,
      setSidePanelSlot,
      sidePanelSlot,
    ],
  );

  useEffect(() => {
    if (developerFeaturesEnabled !== false) return;
    const removeDebugPanel = (current: DesktopPanelSlotState) => {
      const debugPanel = current.panels.find((panel) => panel.type === 'conversation-debug');
      return debugPanel ? removePanelFromSlotState(current, debugPanel.id) : current;
    };
    setSidePanelSlot(removeDebugPanel);
    setBottomPanelSlot(removeDebugPanel);
  }, [developerFeaturesEnabled, setBottomPanelSlot, setSidePanelSlot]);

  const openFilePanel = useCallback((filePath: string) => {
    closeWorkspaceMenus();
    const panel = createFilePanel(filePath);
    if (sidePanelSlot.panels.some((item) => item.id === panel.id)) {
      setSidePanelExpanded(true);
      setSidePanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    if (bottomPanelSlot.panels.some((item) => item.id === panel.id)) {
      setBottomPanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    addPanelToDesktopSlot(fileWorkspacePanelTargetSlot('side', sidePanelSlot, bottomPanelSlot), panel);
  }, [addPanelToDesktopSlot, bottomPanelSlot.panels, closeWorkspaceMenus, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot, sidePanelSlot.panels]);

  const activateDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string) => {
    const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, panelId);
    if (slot === 'side') {
      setSidePanelExpanded(true);
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelSlot(updater);
  }, [setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot]);

  const activateDesktopPanelByType = useCallback((type: DesktopPanelType) => {
    const location = findDesktopPanelLocationByType(sidePanelSlot, bottomPanelSlot, type);
    if (!location) return false;
    activateDesktopPanel(location.slot, location.panelId);
    return true;
  }, [activateDesktopPanel, bottomPanelSlot, sidePanelSlot]);

  const updateBrowserPanel = useCallback((
    identity: ChatComposerTargetIdentity,
    panelId: string,
    patch: DesktopPanelTabPatch,
  ) => {
    updateLayoutForIdentity(identity, (current) => {
      const sidePanelSlot = updatePanelInSlotState(current.sidePanelSlot, panelId, patch);
      const bottomPanelSlot = updatePanelInSlotState(current.bottomPanelSlot, panelId, patch);
      return sidePanelSlot === current.sidePanelSlot && bottomPanelSlot === current.bottomPanelSlot
        ? current
        : { ...current, bottomPanelSlot, sidePanelSlot };
    });
  }, [updateLayoutForIdentity]);

  const updateDesktopPanel = useCallback((panelId: string, patch: DesktopPanelTabPatch) => {
    updateBrowserPanel(targetIdentity, panelId, patch);
  }, [targetIdentity, updateBrowserPanel]);

  const reorderDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => {
    const updater = (current: DesktopPanelSlotState) => reorderPanelInSlotState(current, panelId, targetPanelId, placement);
    if (slot === 'side') {
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelSlot(updater);
  }, [setBottomPanelSlot, setSidePanelSlot]);

  const moveDesktopPanel = useCallback((
    sourceSlot: DesktopPanelSlot,
    panelId: string,
    targetSlot: DesktopPanelSlot,
    targetPanelId: string | null,
    placement: DesktopPanelDropPlacement,
  ) => {
    if (sourceSlot === targetSlot) {
      if (targetPanelId) reorderDesktopPanel(sourceSlot, panelId, targetPanelId, placement);
      return;
    }
    updateLayoutForIdentity(targetIdentity, (current) => {
      const source = sourceSlot === 'side' ? current.sidePanelSlot : current.bottomPanelSlot;
      const target = targetSlot === 'side' ? current.sidePanelSlot : current.bottomPanelSlot;
      const moved = movePanelBetweenSlotStates(source, target, panelId, targetPanelId, placement);
      if (moved.source === source && moved.target === target) return current;
      const sidePanelSlot = sourceSlot === 'side' ? moved.source : moved.target;
      const bottomPanelSlot = sourceSlot === 'bottom' ? moved.source : moved.target;
      return {
        ...current,
        bottomPanelSlot,
        sidePanelExpanded: targetSlot === 'side' || (current.sidePanelExpanded && sidePanelSlot.panels.length > 0),
        sidePanelSlot,
      };
    });
  }, [reorderDesktopPanel, targetIdentity, updateLayoutForIdentity]);

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
    [bottomPanelSlot, closeTerminalSessionsForPanel, setBottomPanelSlot, setSidePanelSlot, sidePanelSlot],
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
    [bottomPanelSlot, closeTerminalSessionsForPanel, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot, sidePanelSlot],
  );

  const toggleSidePanel = useCallback(() => {
    if (sidePanelExpanded && sidePanelSlot.active) {
      setSidePanelExpanded(false);
      closeWorkspaceMenus();
      return;
    }
    if (!sidePanelSlot.active) setSidePanelSlot(createDefaultSidePanelSlot());
    setSidePanelExpanded(true);
  }, [closeWorkspaceMenus, setSidePanelExpanded, setSidePanelSlot, sidePanelExpanded, sidePanelSlot.active]);

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
  }, [activateDesktopPanel, bottomPanelSlot, closeDesktopPanelItem, createTerminalPanel, setBottomPanelSlot]);

  useEffect(() => {
    [sideActivePanel, bottomActivePanel]
      .filter((panel): panel is DesktopPanelTab => panel?.type === 'terminal')
      .forEach((panel) => void openTerminalSessionForPanel(panel.id));
  }, [bottomActivePanel, openTerminalSessionForPanel, sideActivePanel]);

  const openFileWithWorkspaceApp = useCallback(
    async (appId: string, filePath?: string | null, line?: number) => {
      if (!activeProject?.path) return;
      if (!workspaceApps.some((app) => app.id === appId)) {
        setError(t('workspace.panels.appUnavailable'));
        return;
      }
      try {
        const api = window.setsunaDesktop?.workspaceApps;
        if (!api) throw new Error(t('workspace.panels.externalOpenUnsupported'));
        await api.open(activeProject.path, appId, filePath ?? null, line ?? null);
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    },
    [activeProject?.path, setError, t, workspaceApps],
  );

  const openFileInWorkspaceApp = useCallback(
    async (filePath?: string | null, line?: number) => {
      if (!selectedWorkspaceApp) return;
      await openFileWithWorkspaceApp(selectedWorkspaceApp.id, filePath, line);
    },
    [openFileWithWorkspaceApp, selectedWorkspaceApp],
  );

  const copyWorkspaceFilePath = useCallback(async (filePath: string) => {
    if (!activeProject?.path) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api) {
      setError(t('workspace.panels.copyPathUnsupported'));
      return;
    }
    try {
      const result = await api.copyWorkspaceFilePath(activeProject.path, filePath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject?.path, setError, t]);

  const openWorkspaceDirectory = useCallback(async (directoryPath: string) => {
    if (!activeProject?.path) return;
    const openDirectory = window.setsunaDesktop?.desktop?.openWorkspaceDirectory;
    if (!openDirectory) {
      setError(t('chat.mention.openDirectoryUnsupported'));
      return;
    }
    try {
      const result = await openDirectory(activeProject.path, directoryPath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject?.path, setError, t]);

  const revealWorkspaceFile = useCallback(async (filePath: string) => {
    if (!activeProject?.path) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api) {
      setError(t('workspace.panels.revealUnsupported'));
      return;
    }
    try {
      const result = await api.revealWorkspaceFile(activeProject.path, filePath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject?.path, setError, t]);

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
      activateDesktopPanelByType,
      bottomActivePanel,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelActive,
      bottomTerminalPanelOpen,
      browserPanelInstances,
      claimForThread,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      copyWorkspaceFilePath,
      developerFeaturesEnabled: developerFeaturesEnabled === true,
      loadReviewState,
      moveDesktopPanel,
      openBrowserPanel,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFileWithWorkspaceApp,
      openFilePanel,
      openWorkspaceDirectory,
      openSelectedWorkspaceApp,
      panelLauncherTypes,
      panelLauncherMenuOpen,
      resetNewThreadPanelSession,
      resetThreadPanelSession,
      reviewError,
      reviewLoading,
      reviewState,
      revealWorkspaceFile,
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
      updateBrowserPanel,
      updateDesktopPanel,
      workspaceAppMenuOpen,
      workspaceApps,
    }),
    [
      activateDesktopPanel,
      activateDesktopPanelByType,
      bottomActivePanel,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelActive,
      bottomTerminalPanelOpen,
      browserPanelInstances,
      claimForThread,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      copyWorkspaceFilePath,
      developerFeaturesEnabled,
      loadReviewState,
      moveDesktopPanel,
      openBrowserPanel,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFileWithWorkspaceApp,
      openFilePanel,
      openWorkspaceDirectory,
      openSelectedWorkspaceApp,
      panelLauncherTypes,
      panelLauncherMenuOpen,
      resetNewThreadPanelSession,
      resetThreadPanelSession,
      reviewError,
      reviewLoading,
      reviewState,
      revealWorkspaceFile,
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
      updateBrowserPanel,
      updateDesktopPanel,
      workspaceAppMenuOpen,
      workspaceApps,
    ],
  );
}

function terminalSessionKey(panelId: string, projectKey: string): string {
  return `${panelId}:${projectKey}`;
}

function isSingletonDesktopPanelType(type: DesktopPanelType): boolean {
  return type === 'overview' || type === 'conversation-debug' || type === 'review' || type === 'files';
}

export type DesktopWorkspacePanelsState = ReturnType<typeof useDesktopWorkspacePanels>;
export type DesktopBrowserPanelInstance = DesktopWorkspaceBrowserPanelInstance;
