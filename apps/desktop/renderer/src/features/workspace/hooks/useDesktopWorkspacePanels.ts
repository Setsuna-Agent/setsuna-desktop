import { workspaceProjectRoots, workspaceProjectForRoot, workspaceTarget, workspaceTargetKey, resolveWorkspaceFileReference, type WorkspaceProject } from '@setsuna-desktop/contracts';
import type { CollaborationTask } from '@setsuna-desktop/feature-collaboration/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearTerminalWorkspaceRestoreBuffer } from '../../../composition/TerminalWorkspaceFeatureBoundary.js';
import {
  readPreferredWorkspaceAppId,
  writePreferredWorkspaceAppId,
} from '../../../composition/workspace-apps-feature-adapter.js';
import { useReviewFeatureState } from '../../../composition/review-feature-adapter.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  chatComposerTargetIdentity,
  type ChatComposerTargetIdentity,
} from '../../chat/hooks/useChatComposerSession.js';
import {
  activatePanelInSlotState,
  activePanelInSlot,
  addPanelToSlotState,
  createBrowserPanel,
  createChangesPanel,
  createConversationDebugPanel,
  createDefaultSidePanelSlot,
  createEmptyPanelSlot,
  createFilePanel,
  createFilesPanel,
  createReviewPanel,
  createSideChatPanel as createSideChatPanelTab,
  createSubagentPanel,
  createWorkspaceOverviewPanel,
  fileWorkspacePanelTargetSlot,
  findDesktopPanelLocationByType,
  movePanelBetweenSlotStates,
  removePanelFromSlotState,
  reconcilePanelRoots,
  reorderPanelInSlotState,
  renameFilePanelsInSlot,
  deleteFilePanelsInSlot,
  slotHasPanelType,
  updatePanelInSlotState,
  type DesktopPanelDropPlacement,
  type DesktopPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
  type DesktopPanelTabPatch,
  type DesktopPanelType,
  type DesktopTerminalSession,
  type DesktopWorkspaceApp,
} from '../model.js';
import {
  desktopWorkspaceBrowserPanelInstances,
  useDesktopWorkspacePanelSession,
  type DesktopWorkspaceBrowserPanelInstance,
  type DesktopWorkspacePanelLayout,
} from './useDesktopWorkspacePanelSession.js';
import { readyThreadWorkspacePath, type ThreadWorkspaceStatus } from './useThreadWorkspace.js';
import { useCommitMessagePanel } from './useCommitMessagePanel.js';
import { useTerminalPanelExit, type TerminalSessionsByPanelId } from './useTerminalPanelExit.js';

// Keep panel contents mounted while the drawer's grid track transitions. Keep
// this duration aligned with the shared --app-sidebar-motion-duration in shell.css.
const SIDE_PANEL_TRANSITION_DURATION_MS = 220;

type SidePanelTransitionPhase = 'opening' | 'closing' | null;

type WorkspacePanelsOptions = {
  activeProject: WorkspaceProject | null | undefined;
  activeView: string;
  conversationDebugEnabled: boolean | null;
  setError: (message: string | null) => void;
  targetIdentity: ChatComposerTargetIdentity;
  workspaceStatus: ThreadWorkspaceStatus;
};

const GLOBAL_TERMINAL_PROJECT_KEY = '__global__';

export function useDesktopWorkspacePanels({
  activeProject,
  activeView,
  conversationDebugEnabled,
  setError,
  targetIdentity,
  workspaceStatus,
}: WorkspacePanelsOptions) {
  const { t } = useI18n();
  const {
    bottomPanelExpanded,
    bottomPanelSlot,
    claimForThread,
    layoutForIdentity,
    layouts,
    removePanel,
    resetForIdentity,
    setBottomPanelExpanded,
    setBottomPanelSlot,
    setSidePanelExpanded,
    setSidePanelSlot,
    sidePanelExpanded,
    sidePanelSlot,
    updateLayoutForIdentity,
  } = useDesktopWorkspacePanelSession(targetIdentity);
  useEffect(() => {
    if (!activeProject || workspaceStatus !== 'ready') return;
    const rootIds = new Set(workspaceProjectRoots(activeProject).map((root) => root.id));
    setSidePanelSlot((slot) => reconcilePanelRoots(slot, rootIds));
    setBottomPanelSlot((slot) => reconcilePanelRoots(slot, rootIds));
  }, [activeProject, workspaceStatus, setSidePanelSlot, setBottomPanelSlot]);
  const {
    loadReviewState,
    reviewError,
    reviewLoading,
    reviewState,
    selectReviewBaseRef,
    setReviewSource,
  } = useReviewFeatureState({ activeProject });
  // These dispatchers are scoped to targetIdentity, so callbacks using them must
  // include them in their dependency list instead of treating them like useState setters.
  const [terminalSessionsByPanelId, setTerminalSessionsByPanelId] = useState<TerminalSessionsByPanelId>({});
  const [panelLauncherMenuOpen, setPanelLauncherMenuOpen] = useState(false);
  const [workspaceApps, setWorkspaceApps] = useState<DesktopWorkspaceApp[]>([]);
  const [selectedWorkspaceAppId, setSelectedWorkspaceAppId] = useState<string | null>(() => readPreferredWorkspaceAppId() || null);
  const pendingTerminalSessionKeysRef = useRef<Set<string>>(new Set());
  const browserPanelSeqRef = useRef(0);
  const terminalPanelSeqRef = useRef(0);
  const sideChatPanelSeqRef = useRef(0);

  const selectedWorkspaceApp = workspaceApps.find((app) => app.id === selectedWorkspaceAppId) ?? workspaceApps[0] ?? null;
  const sideActivePanel = activePanelInSlot(sidePanelSlot);
  const bottomActivePanel = activePanelInSlot(bottomPanelSlot);
  const sidePanelVisible = activeView === 'chat' && sidePanelExpanded && Boolean(sideActivePanel);
  const sidePanelTransition = useSidePanelTransition(sidePanelVisible);
  const sidePanelPresent = sidePanelTransition.present;
  const bottomPanelVisible = activeView === 'chat' && bottomPanelExpanded && Boolean(bottomActivePanel);
  const browserPanelInstances = useMemo(
    () => desktopWorkspaceBrowserPanelInstances(layouts, targetIdentity, {
      bottomVisible: bottomPanelVisible,
      sideVisible: sidePanelPresent,
    }),
    [bottomPanelVisible, layouts, sidePanelPresent, targetIdentity],
  );
  const bottomTerminalPanelOpen = slotHasPanelType(bottomPanelSlot, 'terminal');
  const panelLauncherTypes = useMemo(() => [
    'chat',
    'browser',
    conversationDebugEnabled === true
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
      && (reviewState?.isGitRepository === true || workspaceProjectRoots(activeProject).length > 1)
      && !slotHasPanelType(sidePanelSlot, 'changes')
      && !slotHasPanelType(bottomPanelSlot, 'changes')
      ? 'changes'
      : null,
    activeProject?.path
      && !slotHasPanelType(sidePanelSlot, 'files')
      && !slotHasPanelType(bottomPanelSlot, 'files')
      ? 'files'
      : null,
    'terminal',
  ].filter(Boolean) as DesktopPanelType[], [activeProject, bottomPanelSlot, conversationDebugEnabled, reviewState?.isGitRepository, sidePanelSlot]);
  const terminalRoot = useCallback((rootId?: string) => activeProject
    ? workspaceProjectRoots(activeProject).find((root) => root.id === rootId) ?? workspaceProjectRoots(activeProject)[0] : undefined, [activeProject]);
  const terminalKey = useCallback((rootId?: string) => workspaceTargetKey(workspaceTarget(
    activeProject?.id ?? GLOBAL_TERMINAL_PROJECT_KEY, terminalRoot(rootId)?.id,
  )), [activeProject?.id, terminalRoot]);
  const activeTerminalSessionsByPanelId = useMemo(() => {
    const sessions: Record<string, DesktopTerminalSession> = {};
    for (const [panelId, sessionsByProject] of Object.entries(terminalSessionsByPanelId)) {
      const panel = [...sidePanelSlot.panels, ...bottomPanelSlot.panels].find((item) => item.id === panelId);
      const session = sessionsByProject[terminalKey(panel?.rootId)];
      if (session) sessions[panelId] = session;
    }
    return sessions;
  }, [bottomPanelSlot.panels, sidePanelSlot.panels, terminalKey, terminalSessionsByPanelId]);

  const closeWorkspaceMenus = useCallback(() => {
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
        clearTerminalWorkspaceRestoreBuffer(session.sessionId);
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

  const closeExitedTerminalPanel = useCallback((panelId: string, projectKey: string, sessionId: string) => {
    const sessions = terminalSessionsByPanelId[panelId];
    if (sessions?.[projectKey]?.sessionId !== sessionId) return;
    clearTerminalWorkspaceRestoreBuffer(sessionId);
    void window.setsunaDesktop?.terminal.close(sessionId).catch(() => undefined);
    if (Object.keys(sessions).length === 1) removePanel(panelId);
    else {
      const remainingKey = Object.keys(sessions).find((key) => key !== projectKey)!;
      const rootId = (JSON.parse(remainingKey) as [string, string | null])[1] ?? undefined;
      const selectRemaining = (slot: DesktopPanelSlotState) => {
        const panel = slot.panels.find((item) => item.id === panelId);
        return panel && terminalKey(panel.rootId) === projectKey ? updatePanelInSlotState(slot, panelId, { rootId }) : slot;
      };
      setSidePanelSlot(selectRemaining);
      setBottomPanelSlot(selectRemaining);
    }
    setTerminalSessionsByPanelId((current) => {
      const remaining = { ...current[panelId] };
      delete remaining[projectKey];
      const next = { ...current, [panelId]: remaining };
      if (!Object.keys(remaining).length) delete next[panelId];
      return next;
    });
  }, [removePanel, setBottomPanelSlot, setSidePanelSlot, terminalKey, terminalSessionsByPanelId]);
  useTerminalPanelExit(terminalSessionsByPanelId, closeExitedTerminalPanel);

  useEffect(() => {
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
  }, [activeProject?.path]);

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

  const createBrowserPanelTab = useCallback((url?: string, tabId?: string): DesktopPanelTab => {
    browserPanelSeqRef.current += 1;
    return createBrowserPanel(tabId ?? `browser-${Date.now()}-${browserPanelSeqRef.current}`, url);
  }, []);

  const addPanelToDesktopSlot = useCallback((slot: DesktopPanelSlot, panel: DesktopPanelTab) => {
    const updater = (current: DesktopPanelSlotState) => addPanelToSlotState(current, panel);
    if (slot === 'side') {
      setSidePanelExpanded(true);
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelExpanded(true);
    setBottomPanelSlot(updater);
  }, [setBottomPanelExpanded, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot]);

  const openBrowserPanel = useCallback((url?: string, slot: DesktopPanelSlot = 'side', tabId?: string) => {
    closeWorkspaceMenus();
    addPanelToDesktopSlot(slot, createBrowserPanelTab(url, tabId));
  }, [addPanelToDesktopSlot, closeWorkspaceMenus, createBrowserPanelTab]);

  const openTerminalSessionForPanel = useCallback(
    async (panelId: string, rootId?: string) => {
      const root = terminalRoot(rootId);
      const terminalProjectKey = terminalKey(rootId);
      const terminalWorkspacePath = activeProject && root
        ? readyThreadWorkspacePath(workspaceProjectForRoot(activeProject, root.id), workspaceStatus) : null;
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
    [activeProject, setError, terminalKey, terminalRoot, terminalSessionsByPanelId, workspaceStatus],
  );

  const openDesktopPanel = useCallback(
    (slot: DesktopPanelSlot, type: DesktopPanelType) => {
      if (type === 'file' || type === 'commit-message') return;
      if (type === 'conversation-debug' && conversationDebugEnabled !== true) return;
      if (type === 'review' && !activeProject) return;
      if ((type === 'files' || type === 'changes') && !activeProject?.path) return;
      closeWorkspaceMenus();
      if (isSingletonDesktopPanelType(type)) {
        const existing = findDesktopPanelLocationByType(sidePanelSlot, bottomPanelSlot, type);
        if (existing) {
          const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, existing.panelId);
          if (existing.slot === 'side') {
            setSidePanelExpanded(true);
            setSidePanelSlot(updater);
          } else {
            setBottomPanelExpanded(true);
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
                  : type === 'changes'
                    ? createChangesPanel()
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
      conversationDebugEnabled,
      setBottomPanelExpanded,
      setBottomPanelSlot,
      setSidePanelExpanded,
      setSidePanelSlot,
      sidePanelSlot,
    ],
  );

  useEffect(() => {
    if (conversationDebugEnabled !== false) return;
    const removeDebugPanel = (current: DesktopPanelSlotState) => {
      const debugPanel = current.panels.find((panel) => panel.type === 'conversation-debug');
      return debugPanel ? removePanelFromSlotState(current, debugPanel.id) : current;
    };
    setSidePanelSlot(removeDebugPanel);
    setBottomPanelSlot(removeDebugPanel);
  }, [conversationDebugEnabled, setBottomPanelSlot, setSidePanelSlot]);

  const openFilePanel = useCallback((filePath: string, rootId?: string) => {
    closeWorkspaceMenus();
    const panel = createFilePanel(filePath, rootId);
    if (sidePanelSlot.panels.some((item) => item.id === panel.id)) {
      setSidePanelExpanded(true);
      setSidePanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    if (bottomPanelSlot.panels.some((item) => item.id === panel.id)) {
      setBottomPanelExpanded(true);
      setBottomPanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    addPanelToDesktopSlot(fileWorkspacePanelTargetSlot('side', sidePanelSlot, bottomPanelSlot), panel);
  }, [addPanelToDesktopSlot, bottomPanelSlot.panels, closeWorkspaceMenus, setBottomPanelExpanded, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot, sidePanelSlot.panels]);

  const openFilesPanelForRoot = useCallback((rootId: string) => {
    const existing = findDesktopPanelLocationByType(sidePanelSlot, bottomPanelSlot, 'files');
    addPanelToDesktopSlot(existing?.slot ?? fileWorkspacePanelTargetSlot('side', sidePanelSlot, bottomPanelSlot), { ...createFilesPanel(), rootId });
    const update = (slot: DesktopPanelSlotState) => updatePanelInSlotState(slot, 'files', { rootId });
    setSidePanelSlot(update);
    setBottomPanelSlot(update);
  }, [addPanelToDesktopSlot, bottomPanelSlot, setBottomPanelSlot, setSidePanelSlot, sidePanelSlot]);

  const renameFilePanels = useCallback((previousPath: string, nextPath: string, rootId?: string) => {
    setSidePanelSlot((slot) => renameFilePanelsInSlot(slot, previousPath, nextPath, rootId));
    setBottomPanelSlot((slot) => renameFilePanelsInSlot(slot, previousPath, nextPath, rootId));
  }, [setBottomPanelSlot, setSidePanelSlot]);

  const deleteFilePanels = useCallback((entryPath: string, rootId?: string) => {
    setSidePanelSlot((slot) => deleteFilePanelsInSlot(slot, entryPath, rootId));
    setBottomPanelSlot((slot) => deleteFilePanelsInSlot(slot, entryPath, rootId));
  }, [setBottomPanelSlot, setSidePanelSlot]);

  /**
   * 打开子代理只读面板。面板 id 固定为 subagent:<childThreadId>，因此正文卡片和
   * 环境面板反复点击只会激活同一个 tab；关闭面板不影响 child 线程本身。
   */
  const openSubagentPanel = useCallback((parentThreadId: string, task: CollaborationTask) => {
    closeWorkspaceMenus();
    const panel = createSubagentPanel(task.childThreadId, parentThreadId, task.identity.displayName);
    if (sidePanelSlot.panels.some((item) => item.id === panel.id)) {
      setSidePanelExpanded(true);
      setSidePanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    if (bottomPanelSlot.panels.some((item) => item.id === panel.id)) {
      setBottomPanelExpanded(true);
      setBottomPanelSlot((current) => activatePanelInSlotState(current, panel.id));
      return;
    }
    addPanelToDesktopSlot('side', panel);
  }, [addPanelToDesktopSlot, bottomPanelSlot.panels, closeWorkspaceMenus, setBottomPanelExpanded, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot, sidePanelSlot.panels]);

  const activateDesktopPanel = useCallback((slot: DesktopPanelSlot, panelId: string) => {
    const updater = (current: DesktopPanelSlotState) => activatePanelInSlotState(current, panelId);
    if (slot === 'side') {
      setSidePanelExpanded(true);
      setSidePanelSlot(updater);
      return;
    }
    setBottomPanelExpanded(true);
    setBottomPanelSlot(updater);
  }, [setBottomPanelExpanded, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot]);

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
        bottomPanelExpanded: targetSlot === 'bottom' || (current.bottomPanelExpanded && bottomPanelSlot.panels.length > 0),
        bottomPanelSlot,
        sidePanelExpanded: targetSlot === 'side' || (current.sidePanelExpanded && sidePanelSlot.panels.length > 0),
        sidePanelSlot,
      };
    });
  }, [reorderDesktopPanel, targetIdentity, updateLayoutForIdentity]);

  const { open: openCommitMessageEditor, close: closeCommitMessageEditor } = useCommitMessagePanel({
    targetIdentity, addPanel: addPanelToDesktopSlot, updateLayout: updateLayoutForIdentity,
  });

  const resetPanelSession = useCallback((identity: ChatComposerTargetIdentity) => {
    const layout = layoutForIdentity(identity);
    // Resetting within the same project must settle amend without accepting its draft.
    [...layout.sidePanelSlot.panels, ...layout.bottomPanelSlot.panels]
      .filter((panel) => panel.type === 'commit-message')
      .forEach((panel) => closeCommitMessageEditor(panel.id, true));
    closeTerminalSessionsForLayout(layout);
    resetForIdentity(identity);
    if (identity === targetIdentity) closeWorkspaceMenus();
  }, [closeCommitMessageEditor, closeTerminalSessionsForLayout, closeWorkspaceMenus, layoutForIdentity, resetForIdentity, targetIdentity]);

  const resetNewThreadPanelSession = useCallback((projectId: string | null) => {
    resetPanelSession(chatComposerTargetIdentity(null, projectId));
    closeWorkspaceMenus();
  }, [closeWorkspaceMenus, resetPanelSession]);

  const resetThreadPanelSession = useCallback((threadId: string) => {
    resetPanelSession(chatComposerTargetIdentity(threadId, null));
  }, [resetPanelSession]);

  const closeDesktopPanelItem = useCallback(
    (slot: DesktopPanelSlot, panelId: string) => {
      const slotState = slot === 'side' ? sidePanelSlot : bottomPanelSlot;
      const panel = slotState.panels.find((item) => item.id === panelId);
      if (panel?.type === 'commit-message') closeCommitMessageEditor(panelId);
      if (panel?.type === 'terminal') closeTerminalSessionsForPanel(panel.id);
      const updater = (current: DesktopPanelSlotState) => removePanelFromSlotState(current, panelId);
      if (slot === 'side') {
        setSidePanelSlot(updater);
        return;
      }
      setBottomPanelSlot(updater);
    },
    [bottomPanelSlot, closeCommitMessageEditor, closeTerminalSessionsForPanel, setBottomPanelSlot, setSidePanelSlot, sidePanelSlot],
  );

  const closeActiveSidePanel = useCallback(() => {
    if (!sidePanelVisible || !sideActivePanel) return;
    closeDesktopPanelItem('side', sideActivePanel.id);
  }, [closeDesktopPanelItem, sideActivePanel, sidePanelVisible]);

  const closeDesktopPanelSlot = useCallback(
    (slot: DesktopPanelSlot) => {
      const slotState = slot === 'side' ? sidePanelSlot : bottomPanelSlot;
      slotState.panels.filter((panel) => panel.type === 'commit-message').forEach((panel) => closeCommitMessageEditor(panel.id, true));
      slotState.panels.filter((panel) => panel.type === 'terminal').forEach((panel) => closeTerminalSessionsForPanel(panel.id));
      if (slot === 'side') {
        setSidePanelExpanded(false);
        setSidePanelSlot(createEmptyPanelSlot());
        return;
      }
      setBottomPanelExpanded(false);
      setBottomPanelSlot(createEmptyPanelSlot());
    },
    [bottomPanelSlot, closeCommitMessageEditor, closeTerminalSessionsForPanel, setBottomPanelExpanded, setBottomPanelSlot, setSidePanelExpanded, setSidePanelSlot, sidePanelSlot],
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

  const hideBottomPanel = useCallback(() => {
    setBottomPanelExpanded(false);
    closeWorkspaceMenus();
  }, [closeWorkspaceMenus, setBottomPanelExpanded]);

  const toggleBottomPanel = useCallback(() => {
    // Visibility is independent of tab lifetime; reopening restores the selected tab.
    if (bottomPanelSlot.active) {
      setBottomPanelExpanded((expanded) => !expanded);
      closeWorkspaceMenus();
      return;
    }
    addPanelToDesktopSlot('bottom', createTerminalPanel());
  }, [addPanelToDesktopSlot, bottomPanelSlot.active, closeWorkspaceMenus, createTerminalPanel, setBottomPanelExpanded]);

  useEffect(() => {
    [sideActivePanel, bottomActivePanel]
      .filter((panel): panel is DesktopPanelTab => panel?.type === 'terminal')
      .forEach((panel) => void openTerminalSessionForPanel(panel.id, panel.rootId));
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
        await api.open(resolveWorkspaceFileReference(activeProject, filePath ?? '.')?.root.path ?? activeProject.path, appId, filePath ?? null, line ?? null);
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    },
    [activeProject, setError, t, workspaceApps],
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
      const result = await api.copyWorkspaceFilePath(resolveWorkspaceFileReference(activeProject, filePath)?.root.path ?? activeProject.path, filePath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  const openWorkspaceDirectory = useCallback(async (directoryPath: string) => {
    if (!activeProject?.path) return;
    const openDirectory = window.setsunaDesktop?.desktop?.openWorkspaceDirectory;
    if (!openDirectory) {
      setError(t('chat.mention.openDirectoryUnsupported'));
      return;
    }
    try {
      const result = await openDirectory(resolveWorkspaceFileReference(activeProject, directoryPath)?.root.path ?? activeProject.path, directoryPath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  const revealWorkspaceFile = useCallback(async (filePath: string) => {
    if (!activeProject?.path) return;
    const api = window.setsunaDesktop?.desktop;
    if (!api) {
      setError(t('workspace.panels.revealUnsupported'));
      return;
    }
    try {
      const result = await api.revealWorkspaceFile(resolveWorkspaceFileReference(activeProject, filePath)?.root.path ?? activeProject.path, filePath);
      if (!result.ok) setError(result.error);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [activeProject, setError, t]);

  const togglePanelLauncherMenu = useCallback(() => {
    setPanelLauncherMenuOpen((value) => !value);
  }, []);

  const openWorkspaceInApp = useCallback(
    async (appId: string) => {
      if (!activeProject?.path || !workspaceApps.some((app) => app.id === appId)) return;
      setSelectedWorkspaceAppId(appId);
      writePreferredWorkspaceAppId(appId);
      closeWorkspaceMenus();
      await openFileWithWorkspaceApp(appId);
    },
    [activeProject?.path, closeWorkspaceMenus, openFileWithWorkspaceApp, workspaceApps],
  );

  return useMemo(
    () => ({
      activateDesktopPanel,
      activateDesktopPanelByType,
      bottomActivePanel,
      bottomPanelExpanded,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelOpen,
      browserPanelInstances,
      claimForThread,
      closeActiveSidePanel,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      copyWorkspaceFilePath,
      conversationDebugEnabled: conversationDebugEnabled === true,
      hideBottomPanel,
      loadReviewState,
      moveDesktopPanel,
      openBrowserPanel,
      openCommitMessageEditor,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFileWithWorkspaceApp,
      openFilePanel,
      openFilesPanelForRoot,
      renameFilePanels,
      deleteFilePanels,
      openSubagentPanel,
      openWorkspaceDirectory,
      openWorkspaceInApp,
      panelLauncherTypes,
      panelLauncherMenuOpen,
      resetNewThreadPanelSession,
      resetThreadPanelSession,
      reviewError,
      reviewLoading,
      reviewState,
      revealWorkspaceFile,
      reorderDesktopPanel,
      selectedWorkspaceApp,
      selectReviewBaseRef,
      setReviewSource,
      sideActivePanel,
      sidePanelSlot,
      sidePanelPresent,
      sidePanelTransitionPhase: sidePanelTransition.phase,
      sidePanelVisible,
      terminalSessionsByPanelId: activeTerminalSessionsByPanelId,
      toggleBottomPanel,
      togglePanelLauncherMenu,
      toggleSidePanel,
      updateBrowserPanel,
      updateDesktopPanel,
      workspaceApps,
    }),
    [
      activateDesktopPanel,
      activateDesktopPanelByType,
      bottomActivePanel,
      bottomPanelExpanded,
      bottomPanelSlot,
      bottomPanelVisible,
      bottomTerminalPanelOpen,
      browserPanelInstances,
      claimForThread,
      closeActiveSidePanel,
      closeDesktopPanelItem,
      closeDesktopPanelSlot,
      closeWorkspaceMenus,
      copyWorkspaceFilePath,
      conversationDebugEnabled,
      hideBottomPanel,
      loadReviewState,
      moveDesktopPanel,
      openBrowserPanel,
      openCommitMessageEditor,
      openDesktopPanel,
      openFileInWorkspaceApp,
      openFileWithWorkspaceApp,
      openFilePanel,
      openFilesPanelForRoot,
      renameFilePanels,
      deleteFilePanels,
      openSubagentPanel,
      openWorkspaceDirectory,
      openWorkspaceInApp,
      panelLauncherTypes,
      panelLauncherMenuOpen,
      resetNewThreadPanelSession,
      resetThreadPanelSession,
      reviewError,
      reviewLoading,
      reviewState,
      revealWorkspaceFile,
      reorderDesktopPanel,
      selectedWorkspaceApp,
      selectReviewBaseRef,
      setReviewSource,
      sideActivePanel,
      sidePanelSlot,
      sidePanelPresent,
      sidePanelTransition.phase,
      sidePanelVisible,
      activeTerminalSessionsByPanelId,
      toggleBottomPanel,
      togglePanelLauncherMenu,
      toggleSidePanel,
      updateBrowserPanel,
      updateDesktopPanel,
      workspaceApps,
    ],
  );
}

export function useSidePanelTransition(visible: boolean): {
  phase: SidePanelTransitionPhase;
  present: boolean;
} {
  const [state, setState] = useState(() => ({
    phase: null as SidePanelTransitionPhase,
    present: visible,
    targetVisible: visible,
  }));
  // Adjust before children commit. Updating the same derived state in an effect
  // would render the entire workspace again just after mounting its contents.
  if (state.targetVisible !== visible) {
    setState({
      phase: visible ? 'opening' : 'closing',
      present: visible || state.present,
      targetVisible: visible,
    });
  }

  useEffect(() => {
    if (state.phase === null) return undefined;
    const targetVisible = state.targetVisible;
    const timeoutId = window.setTimeout(() => {
      setState((current) => (
        current.targetVisible === targetVisible
          ? { phase: null, present: targetVisible, targetVisible }
          : current
      ));
    }, SIDE_PANEL_TRANSITION_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [state.phase, state.targetVisible]);

  return {
    phase: state.phase,
    present: state.present,
  };
}

function terminalSessionKey(panelId: string, projectKey: string): string {
  return `${panelId}:${projectKey}`;
}

function isSingletonDesktopPanelType(type: DesktopPanelType): boolean {
  return type === 'overview' || type === 'conversation-debug' || type === 'review' || type === 'changes' || type === 'files';
}

export type DesktopWorkspacePanelsState = ReturnType<typeof useDesktopWorkspacePanels>;
export type DesktopBrowserPanelInstance = DesktopWorkspaceBrowserPanelInstance;
