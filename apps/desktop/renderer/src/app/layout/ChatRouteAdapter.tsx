import type { WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { latestBrowserFeatureOpenRequest } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { usePluginManagementFeatureSnapshot } from '../../composition/PluginManagementFeatureBoundary.js';
import { useSkillsFeatureSnapshot } from '../../composition/SkillsFeatureBoundary.js';
import { markdownLinkOpenModeFromConfig } from '../../features/chat/markdown/markdownLinkPreference.js';
import { fileChangesFromToolRun } from '../../features/chat/tool-runs/runtimeFileChanges.js';
import type {
  DesktopReviewFocusRequest,
  DesktopReviewOpenHandler,
} from '../../features/workspace/model.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AppChatSurface } from './AppChatSurface.js';
import type { AppRouteContentProps } from './AppRouteContent.js';
import type { ChatConversationSurfaceModel } from './ChatConversationSurface.js';
import type { DesktopWorkspacePanelModel } from './DesktopWorkspacePanelLayer.js';

type ScopedReviewFocusRequest = Readonly<{
  ownerKey: string;
  request: DesktopReviewFocusRequest;
}>;

type ChatRouteAdapterProps = Omit<
  AppRouteContentProps,
  | 'activeView'
  | 'onSelectSkillForChat'
  | 'onSelectedCapabilitiesPluginIdChange'
  | 'selectedCapabilitiesPluginId'
  | 'setActiveView'
  | 'settingsInitialSection'
>;

export function ChatRouteAdapter({
  activeProject,
  activeWorkspace,
  chatActions,
  composerKey,
  conversationOverviewVisibility,
  draft,
  focusComposerRequest,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onOpenModelSettings,
  onOpenPlugin,
  onSkillSelectionRequestConsumed,
  onTerminalResizeStart,
  onTerminalResizeStep,
  onWorkspaceResizeStart,
  onWorkspaceResizeStep,
  projectWorkspace,
  runtime,
  setDraft,
  skillSelectionRequest,
  startCurrentThreadReview,
  terminalHeight,
  terminalMaxHeight,
  terminalMinHeight,
  workspaceMaxWidth,
  workspaceMinWidth,
  workspacePanels,
  workspaceWidth,
}: ChatRouteAdapterProps) {
  const { t } = useI18n();
  const pluginManagement = usePluginManagementFeatureSnapshot();
  const skills = useSkillsFeatureSnapshot();
  const [scopedReviewFocusRequest, setScopedReviewFocusRequest] = useState<ScopedReviewFocusRequest | null>(null);
  const reviewFocusOwnerKey = `${runtime.currentThread?.id ?? ''}:${activeWorkspace?.id ?? ''}`;
  const reviewFocusRequest = scopedReviewFocusRequest?.ownerKey === reviewFocusOwnerKey
    ? scopedReviewFocusRequest.request
    : null;
  const handledBrowserOpenRequestIdRef = useRef<string | null>(null);
  const pendingBrowserOpenRequest = useMemo(
    () => latestBrowserFeatureOpenRequest(runtime.activityEvents),
    [runtime.activityEvents],
  );
  const { openBrowserPanel } = workspacePanels;
  const openBrowserUrl = useCallback((url: string) => openBrowserPanel(url), [openBrowserPanel]);
  const markdownLinkOpenMode = markdownLinkOpenModeFromConfig(runtime.config);
  const openMarkdownWebLink = useCallback((url: string) => {
    if (markdownLinkOpenMode === 'in-app') {
      openBrowserUrl(url);
      return;
    }
    const openExternal = window.setsunaDesktop?.links.openExternal;
    if (!openExternal) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void openExternal(url).catch((unknownError: unknown) => {
      runtime.setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    });
  }, [markdownLinkOpenMode, openBrowserUrl, runtime.setError]);

  useEffect(
    () => window.setsunaDesktop?.browser.onOpenNewTab(({ url }) => openBrowserUrl(url)),
    [openBrowserUrl],
  );
  useEffect(() => {
    if (!pendingBrowserOpenRequest || handledBrowserOpenRequestIdRef.current === pendingBrowserOpenRequest.id) return;
    handledBrowserOpenRequestIdRef.current = pendingBrowserOpenRequest.id;
    openBrowserPanel(pendingBrowserOpenRequest.url);
  }, [openBrowserPanel, pendingBrowserOpenRequest]);

  const openFileReviewPanel: DesktopReviewOpenHandler = (filePath, line, finding) => {
    if (!activeWorkspace) return;
    const normalizedFilePath = filePath?.trim();
    setScopedReviewFocusRequest((current) => normalizedFilePath ? {
      ownerKey: reviewFocusOwnerKey,
      request: {
        path: normalizedFilePath,
        ...(line && line > 0 ? { line } : {}),
        ...(finding ? { finding: { ...finding } } : {}),
        version: (current?.request.version ?? 0) + 1,
      },
    } : null);
    const bottomReviewPanel = workspacePanels.bottomPanelSlot.panels.find((panel) => panel.type === 'review');
    if (bottomReviewPanel) {
      workspacePanels.moveDesktopPanel('bottom', bottomReviewPanel.id, 'side', null, 'after');
    } else {
      workspacePanels.openDesktopPanel('side', 'review');
    }
    void workspacePanels.loadReviewState();
  };
  const applyFileChanges = async (toolCallIds: string[], action: WorkspaceFileChangeAction) => {
    const thread = runtime.currentThread;
    if (!thread) throw new Error(t('workspace.error.unavailable'));
    const file = projectWorkspace.filePreview;
    // Disk hashes cannot see an unsaved editor buffer for one of the affected files.
    if (action === 'redo' && file && file.projectId === activeWorkspace?.id
      && (projectWorkspace.fileDraft.dirty || projectWorkspace.fileDraft.saving)) {
      const requested = new Set(toolCallIds);
      const affectsDraft = thread.messages.some((message) => message.toolRuns?.some((run) => (
        requested.has(run.id) && fileChangesFromToolRun(run).some((change) => change.path === file.path)
      )));
      if (affectsDraft) throw new Error(t('toolRun.changes.unsavedConflict'));
    }
    const result = await runtime.client.applyThreadFileChanges(thread.id, { toolCallIds }, action);
    void workspacePanels.loadReviewState();
    void projectWorkspace.refreshFilePreview(() => true);
    return result;
  };
  const setMultiAgentEnabled = (enabled: boolean) => runtime.saveRuntimePreferences({
    features: {
      ...(runtime.config?.features ?? {}),
      multi_agent: enabled,
      multi_agent_v2: enabled,
    },
  });
  const conversation: ChatConversationSurfaceModel = {
    activeTurnId: runtime.activeTurnId,
    activeWorkspace,
    canClearContext: Boolean(runtime.currentThread?.messages.length),
    composerKey,
    config: runtime.config,
    contextCompacting: runtime.contextCompacting,
    conversationOverviewVisibility,
    currentThread: runtime.currentThread,
    draft,
    focusComposerRequest,
    plugins: [...pluginManagement.plugins],
    queuedTurnActions: chatActions,
    reviewError: workspacePanels.reviewError,
    reviewState: workspacePanels.reviewState,
    runtimeClient: runtime.client,
    skillSelectionRequest,
    skills: [...skills.skills],
    onAccessModeChange: (selection) => { void runtime.saveRuntimePreferences(selection); },
    onAnswerApproval: (approvalId, input) => runtime.answerApproval(approvalId, input),
    onCancelActiveTurn: () => { void chatActions.cancelActiveTurn(); },
    onClearContext: () => { void runtime.clearCurrentThreadContext(); },
    onCompactContext: () => { void runtime.compactCurrentThreadContext(); },
    onConversationOverviewRenderedChange,
    onDeleteMessages: chatActions.deleteMessages,
    onFileChangesAction: applyFileChanges,
    onDraftChange: setDraft,
    onEditUserMessage: chatActions.editUserMessage,
    onFocusComposerRequestConsumed,
    onOpenBrowser: workspacePanels.openBrowserPanel,
    onOpenFileReview: openFileReviewPanel,
    onOpenMarkdownWebLink: openMarkdownWebLink,
    onOpenModelSettings,
    onOpenProjectFile: projectWorkspace.openProjectFile,
    onOpenSideChat: () => workspacePanels.openDesktopPanel('side', 'chat'),
    onOpenWorkspaceDirectory: (directoryPath) => { void workspacePanels.openWorkspaceDirectory(directoryPath); },
    onSearchProjectEntries: projectWorkspace.searchProjectEntries,
    onSelectModel: runtime.selectConversationModel,
    onSend: chatActions.sendInput,
    onSetMultiAgentEnabled: setMultiAgentEnabled,
    onSkillSelectionRequestConsumed,
    onStartThreadReview: startCurrentThreadReview,
  };
  const workspace: DesktopWorkspacePanelModel = {
    context: {
      activeProject,
      activeTurnId: runtime.activeTurnId,
      activeWorkspace,
      config: runtime.config,
      currentThread: runtime.currentThread,
      entryOperationPending: projectWorkspace.entryOperationPending,
      fileDraft: projectWorkspace.fileDraft,
      fileFocusRequest: projectWorkspace.fileFocusRequest,
      filePreview: projectWorkspace.filePreview,
      plugins: [...pluginManagement.plugins],
      reviewError: workspacePanels.reviewError,
      reviewFocusRequest,
      reviewLoading: workspacePanels.reviewLoading,
      reviewState: workspacePanels.reviewState,
      runtimeClient: runtime.client,
      selectedWorkspaceApp: workspacePanels.selectedWorkspaceApp,
      skills: [...skills.skills],
      threads: runtime.threads,
      workspaceApps: workspacePanels.workspaceApps,
    },
    panels: {
      bottomActivePanel: workspacePanels.bottomActivePanel,
      bottomPanelSlot: workspacePanels.bottomPanelSlot,
      bottomPanelVisible: workspacePanels.bottomPanelVisible,
      browserPanelInstances: workspacePanels.browserPanelInstances,
      conversationDebugEnabled: workspacePanels.conversationDebugEnabled,
      panelLauncherTypes: workspacePanels.panelLauncherTypes,
      sideActivePanel: workspacePanels.sideActivePanel,
      sidePanelPresent: workspacePanels.sidePanelPresent,
      sidePanelSlot: workspacePanels.sidePanelSlot,
      terminalSessionsByPanelId: workspacePanels.terminalSessionsByPanelId,
    },
    layout: {
      terminalHeight,
      terminalMaxHeight,
      terminalMinHeight,
      workspaceMaxWidth,
      workspaceMinWidth,
      workspaceWidth,
      onTerminalResizeStart,
      onTerminalResizeStep,
      onWorkspaceResizeStart,
      onWorkspaceResizeStep,
    },
    actions: {
      onAccessModeChange: (selection) => { void runtime.saveRuntimePreferences(selection); },
      onActivateBottomPanel: async (panelId) => {
        const panel = workspacePanels.bottomPanelSlot.panels.find((item) => item.id === panelId);
        if (panel?.type === 'file' && panel.filePath) {
          void projectWorkspace.openProjectFile(panel.filePath);
          return;
        }
        if (panel?.type === 'files' && !await projectWorkspace.setFilePreview(null)) return;
        workspacePanels.activateDesktopPanel('bottom', panelId);
      },
      onCloseBottomSlot: () => workspacePanels.closeDesktopPanelSlot('bottom'),
      onClosePanel: workspacePanels.closeDesktopPanelItem,
      onOpenCommitMessageEditor: workspacePanels.openCommitMessageEditor,
      onCopyFilePath: workspacePanels.copyWorkspaceFilePath,
      onCreateEntry: projectWorkspace.createEntry,
      onRenameEntry: projectWorkspace.renameEntry,
      onMoveEntry: projectWorkspace.moveEntry,
      onDeleteEntry: projectWorkspace.deleteEntry,
      onExternalOpenFile: workspacePanels.openFileInWorkspaceApp,
      onMoveBottomPanel: (panelId, targetPlacement, targetPanelId, placement) => {
        workspacePanels.moveDesktopPanel('bottom', panelId, targetPlacement, targetPanelId, placement);
      },
      onOpenBottomPanel: async (panelType) => {
        if (panelType === 'files' && !await projectWorkspace.setFilePreview(null)) return;
        workspacePanels.openDesktopPanel('bottom', panelType);
      },
      onOpenBrowser: workspacePanels.openBrowserPanel,
      onOpenConversationDebug: () => workspacePanels.openDesktopPanel('side', 'conversation-debug'),
      onOpenChangesPanel: () => workspacePanels.openDesktopPanel('side', 'changes'),
      onOpenEntry: (entry) => { void projectWorkspace.openEntry(entry); },
      onOpenFileReviewPanel: openFileReviewPanel,
      onOpenFilesPanel: async () => {
        if (!await projectWorkspace.setFilePreview(null)) return;
        workspacePanels.openDesktopPanel('side', 'files');
      },
      onOpenFileWithApp: workspacePanels.openFileWithWorkspaceApp,
      onOpenMarkdownWebLink: openMarkdownWebLink,
      onOpenProjectFile: projectWorkspace.openProjectFile,
      onOpenSideChat: () => workspacePanels.openDesktopPanel('side', 'chat'),
      onOpenSideTerminalPanel: () => workspacePanels.openDesktopPanel('side', 'terminal'),
      onOpenWorkspaceDirectory: (directoryPath) => { void workspacePanels.openWorkspaceDirectory(directoryPath); },
      onReloadThreads: runtime.reloadThreads,
      onReorderBottomPanels: (panelId, targetPanelId, placement) => {
        workspacePanels.reorderDesktopPanel('bottom', panelId, targetPanelId, placement);
      },
      onReviewBaseRefChange: workspacePanels.selectReviewBaseRef,
      onReviewRefresh: workspacePanels.loadReviewState,
      onReviewSourceChange: workspacePanels.setReviewSource,
      onRevealFile: workspacePanels.revealWorkspaceFile,
      onSearchProjectEntries: projectWorkspace.searchProjectEntries,
      onSelectModel: runtime.selectConversationModel,
      onSetMultiAgentEnabled: setMultiAgentEnabled,
      onSideChatError: runtime.setError,
      onStartThreadReview: startCurrentThreadReview,
      onUpdateBrowserPanel: workspacePanels.updateBrowserPanel,
      onUpdateDesktopPanel: workspacePanels.updateDesktopPanel,
    },
  };

  return <AppChatSurface conversation={conversation} onOpenPlugin={onOpenPlugin} workspace={workspace} />;
}
