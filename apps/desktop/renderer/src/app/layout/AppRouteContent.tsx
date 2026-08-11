import type { RuntimeReviewTarget, WorkspaceProject } from '@setsuna-desktop/contracts';
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
import { latestBrowserOpenRequest } from '../../features/workspace/browser/runtimeBrowserActions.js';
import type { DesktopWorkspacePanelsState } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import type { RuntimeClientState } from '../../services/runtime-client/useRuntimeClientState.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopUpdaterStateView } from '../controller/useDesktopUpdater.js';
import type { DesktopNetworkProxyStateView } from '../controller/useDesktopNetworkProxy.js';
import type { ChatSkillSelectionRequest, ConversationOverviewVisibility, MainView } from '../types.js';
import { AppChatSurface } from './AppChatSurface.js';

const SettingsPage = lazy(() => import('../../features/settings/SettingsRoute.js'));
const CapabilitiesPage = lazy(() => import('../../features/capabilities/CapabilitiesRoute.js'));

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
  networkProxy,
  selectedCapabilitiesPluginId,
  settingsInitialSection,
  setActiveView,
  setDraft,
  skillSelectionRequest,
  startCurrentThreadReview,
  updater,
  workspacePanels,
  onSelectSkillForChat,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onOpenPlugin,
  onOpenModelSettings,
  onSelectedCapabilitiesPluginIdChange,
  onSelectThread,
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
  networkProxy: DesktopNetworkProxyStateView;
  selectedCapabilitiesPluginId: string | null;
  settingsInitialSection?: SettingsSectionId | null;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setDraft: Dispatch<SetStateAction<string>>;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  startCurrentThreadReview: (target: RuntimeReviewTarget) => Promise<unknown>;
  updater: DesktopUpdaterStateView;
  workspacePanels: DesktopWorkspacePanelsState;
  onSelectSkillForChat: (skillId: string) => void;
  onConversationOverviewRenderedChange: (visible: boolean) => void;
  onFocusComposerRequestConsumed: (requestId: number) => void;
  onOpenPlugin: (pluginId: string) => void;
  onOpenModelSettings: () => void;
  onSelectedCapabilitiesPluginIdChange: (pluginId: string | null) => void;
  onSelectThread: (threadId: string) => void | Promise<void>;
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
  const selectedSkillCount = runtime.skills.filter((skill) => skill.enabled && skill.selected).length;
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{ path: string; version: number } | null>(null);
  const handledBrowserOpenRequestIdRef = useRef<string | null>(null);
  const pendingBrowserOpenRequest = useMemo(
    () => latestBrowserOpenRequest(runtime.activityEvents),
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
  const openFileReviewPanel = (filePath?: string) => {
    if (!activeWorkspace) return;
    const normalizedFilePath = filePath?.trim();
    setReviewFocusRequest((current) => (
      normalizedFilePath
        ? { path: normalizedFilePath, version: (current?.version ?? 0) + 1 }
        : null
    ));
    workspacePanels.closeDesktopPanelItem('bottom', 'review');
    workspacePanels.openDesktopPanel('side', 'review');
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
          projects={runtime.projects}
          skillExtraRoots={runtime.skillExtraRoots}
          updater={updater}
          usage={runtime.usage}
          memoryPreview={runtime.memoryPreview}
          memoryPreviewLoading={runtime.memoryPreviewLoading}
          networkProxy={networkProxy}
          onBack={() => setActiveView('chat')}
          onFetchProviderModels={runtime.fetchProviderModels}
          onSaveProviders={runtime.saveProviders}
          onSaveRuntimePreferences={runtime.saveRuntimePreferences}
          onPreviewMemories={runtime.previewMemories}
          onDeleteMemory={runtime.deleteMemory}
          onResetMemories={runtime.clearMemories}
          onDeleteAllArchivedThreads={runtime.permanentlyDeleteArchivedThreads}
          onDeleteArchivedThread={runtime.permanentlyDeleteThread}
          onRestoreArchivedThread={runtime.restoreArchivedThread}
          onSetSkillExtraRoots={runtime.setSkillExtraRoots}
        />
      </Suspense>
    );
  }

  if (activeView === 'capabilities') {
    return (
      <Suspense fallback={<RouteLoadingState label={t('common.loading')} />}>
        <CapabilitiesPage
          config={runtime.config}
          skills={runtime.skills}
          selectedSkillCount={selectedSkillCount}
          mcpState={runtime.mcpState}
          hookState={runtime.hookState}
          plugins={runtime.plugins}
          pluginMarketplace={runtime.pluginMarketplace}
          pluginMarketplaceErrors={runtime.pluginMarketplaceErrors}
          extensionStatuses={runtime.extensionStatuses}
          selectedPluginId={selectedCapabilitiesPluginId}
          onCreateSkill={runtime.createSkill}
          onDeleteSkill={runtime.deleteSkill}
          onGetPluginItemContent={runtime.getPluginItemContent}
          onGetSkillDetail={runtime.getSkillDetail}
          onInstallSkillMcpDependencies={runtime.installSkillMcpDependencies}
          onAuthenticateSkillMcpDependency={runtime.authenticateSkillMcpDependency}
          onCreateInConversation={onSelectSkillForChat}
          onRefresh={runtime.refreshCapabilities}
          onUpdateSkill={runtime.updateSkill}
          onFetchMcpTools={runtime.fetchMcpServerTools}
          onSaveMcpServer={runtime.saveMcpServer}
          onUpdateMcpServer={runtime.updateMcpServer}
          onDeleteMcpServer={(server) => void runtime.deleteMcpServer(server)}
          onLoginMcpServer={runtime.loginMcpServer}
          onLogoutMcpServer={runtime.logoutMcpServer}
          onInstallLocalPlugin={runtime.installLocalPlugin}
          onInstallMarketplacePlugin={runtime.installMarketplacePlugin}
          onUpdateMarketplacePlugin={runtime.updateMarketplacePlugin}
          onRemovePlugin={runtime.removePlugin}
          onSetPluginExtensionTrust={runtime.setPluginExtensionTrust}
          onDeleteStandaloneHook={runtime.deleteStandaloneHook}
          onSetHookEnabled={runtime.setHookEnabled}
          onSetHookTrust={runtime.setHookTrust}
          onSelectedPluginIdChange={onSelectedCapabilitiesPluginIdChange}
          onSaveImageGenerationConfig={runtime.saveImageGenerationConfig}
          onTestImageGeneration={runtime.testImageGeneration}
          onSaveVisionRecognitionConfig={runtime.saveVisionRecognitionConfig}
          onTestVisionRecognition={runtime.testVisionRecognition}
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
      conversationOverviewShowRequest={conversationOverviewShowRequest}
      conversationOverviewVisibility={conversationOverviewVisibility}
      contextCompacting={runtime.contextCompacting}
      currentThread={runtime.currentThread}
      draft={draft}
      fileDraft={projectWorkspace.fileDraft}
      filePreview={projectWorkspace.filePreview}
      plugins={runtime.plugins}
      skillSelectionRequest={skillSelectionRequest}
      reviewError={workspacePanels.reviewError}
      reviewFocusRequest={reviewFocusRequest}
      reviewLoading={workspacePanels.reviewLoading}
      reviewState={workspacePanels.reviewState}
      selectedWorkspaceApp={workspacePanels.selectedWorkspaceApp}
      workspaceApps={workspacePanels.workspaceApps}
      skills={runtime.skills}
      threadUsage={runtime.threadUsage}
      threads={runtime.threads}
      sideActivePanel={workspacePanels.sideActivePanel}
      sidePanelSlot={workspacePanels.sidePanelSlot}
      runtimeClient={runtime.client}
      onReloadThreads={runtime.reloadThreads}
      onFocusComposerRequestConsumed={onFocusComposerRequestConsumed}
      onSideChatError={runtime.setError}
      sidePanelVisible={workspacePanels.sidePanelVisible}
      terminalSessionsByPanelId={workspacePanels.terminalSessionsByPanelId}
      onActivateBottomPanel={(panelId) => workspacePanels.activateDesktopPanel('bottom', panelId)}
      onCancelActiveTurn={() => void chatActions.cancelActiveTurn()}
      onAccessModeChange={(selection) => void runtime.saveRuntimePreferences(selection)}
      onConversationOverviewRenderedChange={onConversationOverviewRenderedChange}
      onAnswerApproval={(approvalId, input) => runtime.answerApproval(approvalId, input)}
      onCompactContext={() => void runtime.compactCurrentThreadContext()}
      onClearContext={() => void runtime.clearCurrentThreadContext()}
      onClearThreadGoal={() => runtime.clearCurrentThreadGoal()}
      onUpdateThreadGoal={(patch) => runtime.updateCurrentThreadGoal(patch)}
      onDeleteMessages={(messageIds) => chatActions.deleteMessages(messageIds)}
      onDiscardFileChanges={discardFileChanges}
      onCloseBottomPanel={(panelId) => workspacePanels.closeDesktopPanelItem('bottom', panelId)}
      onCloseBottomSlot={() => workspacePanels.closeDesktopPanelSlot('bottom')}
      onCopyFilePath={(filePath) => void workspacePanels.copyWorkspaceFilePath(filePath)}
      onDraftChange={setDraft}
      onEditUserMessage={(messageId, content) => chatActions.editUserMessage(messageId, content)}
      onExternalOpenFile={(filePath, line) => void workspacePanels.openFileInWorkspaceApp(filePath, line)}
      onOpenFileWithApp={(appId, filePath, line) => void workspacePanels.openFileWithWorkspaceApp(appId, filePath, line)}
      onSelectModel={(providerId, modelId) => void runtime.selectProviderModel(providerId, modelId)}
      onSearchProjectEntries={projectWorkspace.searchProjectEntries}
      onOpenBottomReviewPanel={() => {
        workspacePanels.openDesktopPanel('bottom', 'review');
        void workspacePanels.loadReviewState();
      }}
      onOpenBottomTerminalPanel={() => workspacePanels.openDesktopPanel('bottom', 'terminal')}
      onOpenBrowser={(url) => workspacePanels.openBrowserPanel(url)}
      onOpenConversationDebug={() => workspacePanels.openDesktopPanel('side', 'conversation-debug')}
      onOpenMarkdownWebLink={openMarkdownWebLink}
      onOpenModelSettings={onOpenModelSettings}
      onOpenPlugin={onOpenPlugin}
      onOpenFilesPanel={() => {
        projectWorkspace.setFilePreview(null);
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenThread={onSelectThread}
      onOpenFileReviewPanel={openFileReviewPanel}
      onOpenSideChat={() => workspacePanels.openDesktopPanel('side', 'chat')}
      onOpenSideTerminalPanel={() => workspacePanels.openDesktopPanel('side', 'terminal')}
      onOpenEntry={(entry) => void projectWorkspace.openEntry(entry)}
      onOpenProjectFile={projectWorkspace.openProjectFile}
      onOpenWorkspaceDirectory={(directoryPath) => void workspacePanels.openWorkspaceDirectory(directoryPath)}
      onReorderBottomPanels={(panelId, targetPanelId, placement) => workspacePanels.reorderDesktopPanel('bottom', panelId, targetPanelId, placement)}
      onReviewRefresh={(options) => workspacePanels.loadReviewState(options)}
      onRevealFile={(filePath) => void workspacePanels.revealWorkspaceFile(filePath)}
      onSetMultiAgentEnabled={(enabled) => runtime.saveRuntimePreferences({
        features: {
          ...(runtime.config?.features ?? {}),
          multi_agent: enabled,
          multi_agent_v2: enabled,
        },
      })}
      onStartThreadReview={() => startCurrentThreadReview({ type: 'uncommittedChanges' })}
      onSend={(value, options) => chatActions.sendInput(value, options)}
      queuedTurnActions={chatActions}
      onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
      onTerminalResizeStep={onTerminalResizeStep}
      onTerminalResizeStart={onTerminalResizeStart}
      onUpdateBrowserPanel={workspacePanels.updateBrowserPanel}
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
