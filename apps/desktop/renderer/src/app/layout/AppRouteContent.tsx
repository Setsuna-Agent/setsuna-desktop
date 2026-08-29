import type {
  RuntimeConfiguredModelReference,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import type { ChatTurnActions } from '../../features/chat/hooks/useChatTurnActions.js';
import { markdownLinkOpenModeFromConfig } from '../../features/chat/markdown/markdownLinkPreference.js';
import type { SettingsSectionId } from '../../features/settings/settings-types.js';
import { latestBrowserFeatureOpenRequest } from '../../composition/browser-feature-adapter.js';
import { usePluginManagementCapabilities } from '../../composition/usePluginManagementCapabilities.js';
import { useMcpCapabilities } from '../../composition/useMcpCapabilities.js';
import { useSkillsCapabilities } from '../../composition/useSkillsCapabilities.js';
import type { DesktopWorkspacePanelsState } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import type {
  DesktopReviewFocusRequest,
  DesktopReviewOpenHandler,
} from '../../features/workspace/model.js';
import type { RuntimeClientState } from '../../services/runtime-client/useRuntimeClientState.js';
import { reportRuntimeBackgroundFailure } from '../../services/runtime-client/runtimeClientErrors.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { ChatSkillSelectionRequest, ConversationOverviewVisibility, MainView } from '../types.js';
import { AppChatSurface } from './AppChatSurface.js';

const SettingsPage = lazy(() => import('../../features/settings/SettingsRoute.js'));
const CapabilitiesPage = lazy(() => import('../../features/capabilities/CapabilitiesRoute.js'));

type ScopedReviewFocusRequest = {
  ownerKey: string;
  request: DesktopReviewFocusRequest;
};

export function AppRouteContent({
  activeProject,
  activeWorkspace,
  activeView,
  chatActions,
  composerKey,
  conversationOverviewShowRequest,
  conversationOverviewVisibility,
  draft,
  focusComposerRequest,
  projectWorkspace,
  runtime,
  selectedCapabilitiesPluginId,
  settingsInitialSection,
  setActiveView,
  setDraft,
  skillSelectionRequest,
  startCurrentThreadReview,
  workspacePanels,
  onSelectSkillForChat,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onOpenPlugin,
  onOpenModelSettings,
  onSelectedCapabilitiesPluginIdChange,
  onSkillSelectionRequestConsumed,
  onTerminalResizeStep,
  onTerminalResizeStart,
  terminalHeight,
  terminalMaxHeight,
  terminalMinHeight,
  onWorkspaceResizeStep,
  onWorkspaceResizeStart,
  workspaceMaxWidth,
  workspaceMinWidth,
  workspaceWidth,
}: {
  activeProject?: WorkspaceProject;
  activeWorkspace?: WorkspaceProject;
  activeView: MainView;
  chatActions: ChatTurnActions;
  composerKey: string;
  conversationOverviewShowRequest: number;
  conversationOverviewVisibility: ConversationOverviewVisibility;
  draft: string;
  focusComposerRequest: number;
  projectWorkspace: ProjectWorkspaceState;
  runtime: RuntimeClientState;
  selectedCapabilitiesPluginId: string | null;
  settingsInitialSection?: SettingsSectionId | null;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setDraft: Dispatch<SetStateAction<string>>;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  startCurrentThreadReview: (
    target: ReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => Promise<unknown>;
  workspacePanels: DesktopWorkspacePanelsState;
  onSelectSkillForChat: (skillId: string) => void;
  onConversationOverviewRenderedChange: (visible: boolean) => void;
  onFocusComposerRequestConsumed: (requestId: number) => void;
  onOpenPlugin: (pluginId: string) => void;
  onOpenModelSettings: () => void;
  onSelectedCapabilitiesPluginIdChange: (pluginId: string | null) => void;
  onSkillSelectionRequestConsumed: (requestId: number) => void;
  onTerminalResizeStep: (delta: number) => void;
  onTerminalResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  terminalHeight: number;
  terminalMaxHeight: number;
  terminalMinHeight: number;
  onWorkspaceResizeStep: (delta: number) => void;
  onWorkspaceResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}) {
  const { t } = useI18n();
  const mcp = useMcpCapabilities();
  const skills = useSkillsCapabilities();
  const refreshCapabilityDependencies = useCallback(async (): Promise<void> => {
    const [mcpResult, skillsResult] = await Promise.allSettled([
      mcp.refresh(),
      skills.refresh(),
    ]);
    if (mcpResult.status === 'rejected') {
      reportRuntimeBackgroundFailure('MCP refresh after plugin mutation', mcpResult.reason);
    }
    if (skillsResult.status === 'rejected') {
      reportRuntimeBackgroundFailure('Skill refresh after plugin mutation', skillsResult.reason);
    }
  }, [mcp.refresh, skills.refresh]);
  const pluginManagement = usePluginManagementCapabilities({
    activeProjectPath: activeProject?.path,
    refreshDependencies: refreshCapabilityDependencies,
  });
  const installSkillMcpDependencies = useCallback(async (
    skill: Parameters<typeof skills.installMcpDependencies>[0],
  ) => {
    const detail = await skills.installMcpDependencies(skill);
    await mcp.refresh();
    return detail;
  }, [mcp.refresh, skills.installMcpDependencies]);
  const authenticateSkillMcpDependency = useCallback(async (
    skill: Parameters<typeof skills.authenticateMcpDependency>[0],
    serverKey: string,
  ) => {
    const detail = await skills.authenticateMcpDependency(skill, serverKey);
    await mcp.refresh();
    return detail;
  }, [mcp.refresh, skills.authenticateMcpDependency]);
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
  const openBrowserUrl = useCallback((url: string) => {
    openBrowserPanel(url);
  }, [openBrowserPanel]);
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

  useEffect(() => window.setsunaDesktop?.browser.onOpenNewTab(({ url }) => openBrowserUrl(url)), [openBrowserUrl]);

  useEffect(() => {
    if (!pendingBrowserOpenRequest || handledBrowserOpenRequestIdRef.current === pendingBrowserOpenRequest.id) return;
    handledBrowserOpenRequestIdRef.current = pendingBrowserOpenRequest.id;
    openBrowserPanel(pendingBrowserOpenRequest.url);
  }, [openBrowserPanel, pendingBrowserOpenRequest]);
  const openFileReviewPanel: DesktopReviewOpenHandler = (
    filePath,
    line,
    finding,
  ) => {
    if (!activeWorkspace) return;
    const normalizedFilePath = filePath?.trim();
    setScopedReviewFocusRequest((current) => (
      normalizedFilePath
        ? {
            ownerKey: reviewFocusOwnerKey,
            request: {
              path: normalizedFilePath,
              ...(line && line > 0 ? { line } : {}),
              ...(finding ? { finding: { ...finding } } : {}),
              version: (current?.request.version ?? 0) + 1,
            },
          }
        : null
    ));
    const bottomReviewPanel = workspacePanels.bottomPanelSlot.panels.find((panel) => (
      panel.type === 'review'
    ));
    if (bottomReviewPanel) {
      // Moving is one layout transaction. close + open races because the open
      // callback still sees the pre-close bottom slot and activates a panel
      // that the preceding update is about to remove.
      workspacePanels.moveDesktopPanel(
        'bottom',
        bottomReviewPanel.id,
        'side',
        null,
        'after',
      );
    } else {
      workspacePanels.openDesktopPanel('side', 'review');
    }
    void workspacePanels.loadReviewState();
  };
  const discardFileChanges = async (filePaths: string[]) => {
    const workspaceRoot = activeWorkspace?.path;
    if (!workspaceRoot) throw new Error(t('workspace.error.unavailable'));
    const reviewApi = window.setsunaDesktop?.desktopReview;
    if (!reviewApi) throw new Error(t('workspace.error.discardUnsupported'));
    await reviewApi.discardUnstaged(workspaceRoot, filePaths);
    await workspacePanels.loadReviewState();
  };

  if (activeView === 'settings') {
    return (
      <Suspense fallback={<RouteLoadingState label={t('common.loading')} />}>
        <SettingsPage
          archivedThreads={runtime.archivedThreads}
          config={runtime.config}
          initialSection={settingsInitialSection ?? undefined}
          skillExtraRoots={skills.extraRoots}
          onBack={() => setActiveView('chat')}
          onSaveRuntimePreferences={runtime.saveRuntimePreferences}
          onDeleteAllArchivedThreads={runtime.permanentlyDeleteArchivedThreads}
          onDeleteArchivedThread={runtime.permanentlyDeleteThread}
          onRestoreArchivedThread={runtime.restoreArchivedThread}
          onSetSkillExtraRoots={skills.setExtraRoots}
        />
      </Suspense>
    );
  }

  if (activeView === 'capabilities') {
    return (
      <Suspense fallback={<RouteLoadingState label={t('common.loading')} />}>
        <CapabilitiesPage
          skills={skills.skills}
          mcpState={mcp.snapshot}
          hooks={pluginManagement.hooks}
          plugins={pluginManagement.plugins}
          pluginMarketplace={pluginManagement.marketplace}
          pluginMarketplaceErrors={pluginManagement.marketplaceErrors}
          extensionStatuses={pluginManagement.extensions}
          selectedPluginId={selectedCapabilitiesPluginId}
          onCreateSkill={skills.createSkill}
          onDeleteSkill={skills.deleteSkill}
          onGetPluginItemContent={pluginManagement.getItemContent}
          onGetSkillDetail={skills.getSkillDetail}
          onInstallSkillMcpDependencies={installSkillMcpDependencies}
          onAuthenticateSkillMcpDependency={authenticateSkillMcpDependency}
          onCreateInConversation={onSelectSkillForChat}
          onRefresh={pluginManagement.refresh}
          onUpdateSkill={skills.updateSkill}
          onFetchMcpTools={mcp.discoverTools}
          onSaveMcpServer={mcp.saveServer}
          onUpdateMcpServer={mcp.updateServer}
          onDeleteMcpServer={mcp.deleteServer}
          onLoginMcpServer={mcp.login}
          onLogoutMcpServer={mcp.logout}
          onInstallLocalPlugin={pluginManagement.installLocal}
          onInstallMarketplacePlugin={pluginManagement.installMarketplace}
          onUpdateMarketplacePlugin={pluginManagement.updateMarketplace}
          onRemovePlugin={pluginManagement.remove}
          onSetPluginExtensionTrust={pluginManagement.setExtensionTrust}
          onDeleteStandaloneHook={pluginManagement.deleteStandaloneHook}
          onSetHookEnabled={pluginManagement.setHookEnabled}
          onSetHookTrust={pluginManagement.setHookTrust}
          onSelectedPluginIdChange={onSelectedCapabilitiesPluginIdChange}
        />
      </Suspense>
    );
  }

  return (
    <AppChatSurface
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      activeTurnId={runtime.activeTurnId}
      bottomActivePanel={workspacePanels.bottomActivePanel}
      bottomPanelSlot={workspacePanels.bottomPanelSlot}
      bottomPanelVisible={workspacePanels.bottomPanelVisible}
      browserPanelInstances={workspacePanels.browserPanelInstances}
      canClearContext={Boolean(runtime.currentThread?.messages.length)}
      composerKey={composerKey}
      focusComposerRequest={focusComposerRequest}
      config={runtime.config}
      conversationDebugEnabled={workspacePanels.conversationDebugEnabled}
      conversationOverviewShowRequest={conversationOverviewShowRequest}
      conversationOverviewVisibility={conversationOverviewVisibility}
      contextCompacting={runtime.contextCompacting}
      currentThread={runtime.currentThread}
      draft={draft}
      fileDraft={projectWorkspace.fileDraft}
      fileFocusRequest={projectWorkspace.fileFocusRequest}
      filePreview={projectWorkspace.filePreview}
      plugins={pluginManagement.plugins}
      panelLauncherTypes={workspacePanels.panelLauncherTypes}
      skillSelectionRequest={skillSelectionRequest}
      reviewError={workspacePanels.reviewError}
      reviewFocusRequest={reviewFocusRequest}
      reviewLoading={workspacePanels.reviewLoading}
      reviewState={workspacePanels.reviewState}
      selectedWorkspaceApp={workspacePanels.selectedWorkspaceApp}
      workspaceApps={workspacePanels.workspaceApps}
      skills={skills.skills}
      threads={runtime.threads}
      sideActivePanel={workspacePanels.sideActivePanel}
      sidePanelSlot={workspacePanels.sidePanelSlot}
      sidePanelPresent={workspacePanels.sidePanelPresent}
      runtimeClient={runtime.client}
      onReloadThreads={runtime.reloadThreads}
      onFocusComposerRequestConsumed={onFocusComposerRequestConsumed}
      onSideChatError={runtime.setError}
      terminalSessionsByPanelId={workspacePanels.terminalSessionsByPanelId}
      onActivateBottomPanel={(panelId) => {
        const panel = workspacePanels.bottomPanelSlot.panels.find((item) => item.id === panelId);
        if (panel?.type === 'file' && panel.filePath) {
          void projectWorkspace.openProjectFile(panel.filePath);
          return;
        }
        if (panel?.type === 'files') projectWorkspace.setFilePreview(null);
        workspacePanels.activateDesktopPanel('bottom', panelId);
      }}
      onCancelActiveTurn={() => void chatActions.cancelActiveTurn()}
      onAccessModeChange={(selection) => void runtime.saveRuntimePreferences(selection)}
      onConversationOverviewRenderedChange={onConversationOverviewRenderedChange}
      onAnswerApproval={(approvalId, input) => runtime.answerApproval(approvalId, input)}
      onCompactContext={() => void runtime.compactCurrentThreadContext()}
      onClearContext={() => void runtime.clearCurrentThreadContext()}
      onDeleteMessages={(messageIds) => chatActions.deleteMessages(messageIds)}
      onDiscardFileChanges={discardFileChanges}
      onClosePanel={(placement, panelId) => workspacePanels.closeDesktopPanelItem(placement, panelId)}
      onCloseBottomSlot={() => workspacePanels.closeDesktopPanelSlot('bottom')}
      onCopyFilePath={workspacePanels.copyWorkspaceFilePath}
      onDraftChange={setDraft}
      onEditUserMessage={(messageId, content) => chatActions.editUserMessage(messageId, content)}
      onExternalOpenFile={workspacePanels.openFileInWorkspaceApp}
      onOpenFileWithApp={workspacePanels.openFileWithWorkspaceApp}
      onSelectModel={runtime.selectConversationModel}
      onSearchProjectEntries={projectWorkspace.searchProjectEntries}
      onOpenBottomPanel={(panelType) => {
        if (panelType === 'files') projectWorkspace.setFilePreview(null);
        workspacePanels.openDesktopPanel('bottom', panelType);
      }}
      onOpenBrowser={(url) => workspacePanels.openBrowserPanel(url)}
      onOpenConversationDebug={() => workspacePanels.openDesktopPanel('side', 'conversation-debug')}
      onOpenMarkdownWebLink={openMarkdownWebLink}
      onOpenModelSettings={onOpenModelSettings}
      onOpenPlugin={onOpenPlugin}
      onOpenFilesPanel={() => {
        projectWorkspace.setFilePreview(null);
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenFileReviewPanel={openFileReviewPanel}
      onOpenSideChat={() => workspacePanels.openDesktopPanel('side', 'chat')}
      onOpenSideTerminalPanel={() => workspacePanels.openDesktopPanel('side', 'terminal')}
      onOpenEntry={(entry) => void projectWorkspace.openEntry(entry)}
      onOpenProjectFile={projectWorkspace.openProjectFile}
      onOpenWorkspaceDirectory={(directoryPath) => void workspacePanels.openWorkspaceDirectory(directoryPath)}
      onMoveBottomPanel={(panelId, targetPlacement, targetPanelId, placement) => {
        workspacePanels.moveDesktopPanel('bottom', panelId, targetPlacement, targetPanelId, placement);
      }}
      onReorderBottomPanels={(panelId, targetPanelId, placement) => workspacePanels.reorderDesktopPanel('bottom', panelId, targetPanelId, placement)}
      onReviewBaseRefChange={workspacePanels.selectReviewBaseRef}
      onReviewRefresh={workspacePanels.loadReviewState}
      onReviewSourceChange={workspacePanels.setReviewSource}
      onRevealFile={workspacePanels.revealWorkspaceFile}
      onSetMultiAgentEnabled={(enabled) => runtime.saveRuntimePreferences({
        features: {
          ...(runtime.config?.features ?? {}),
          multi_agent: enabled,
          multi_agent_v2: enabled,
        },
      })}
      onStartThreadReview={startCurrentThreadReview}
      onSend={(value, options) => chatActions.sendInput(value, options)}
      queuedTurnActions={chatActions}
      onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
      onTerminalResizeStep={onTerminalResizeStep}
      onTerminalResizeStart={onTerminalResizeStart}
      onUpdateBrowserPanel={workspacePanels.updateBrowserPanel}
      onUpdateDesktopPanel={workspacePanels.updateDesktopPanel}
      terminalHeight={terminalHeight}
      terminalMaxHeight={terminalMaxHeight}
      terminalMinHeight={terminalMinHeight}
      onWorkspaceResizeStep={onWorkspaceResizeStep}
      onWorkspaceResizeStart={onWorkspaceResizeStart}
      workspaceMaxWidth={workspaceMaxWidth}
      workspaceMinWidth={workspaceMinWidth}
      workspaceWidth={workspaceWidth}
    />
  );
}

function RouteLoadingState({ label }: { label: string }) {
  return (
    <main className="app-route-loading" role="status">
      {label}
    </main>
  );
}
