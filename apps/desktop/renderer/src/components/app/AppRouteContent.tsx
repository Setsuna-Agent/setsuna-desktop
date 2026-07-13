import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { CapabilitiesPage } from '../pages/CapabilitiesPage.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { AppChatSurface } from './AppChatSurface.js';
import type { ChatTurnActions } from '../../hooks/useChatTurnActions.js';
import type { DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';
import type { DesktopWorkspacePanelsState } from '../../hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../hooks/useProjectWorkspace.js';
import type { RuntimeClientState } from '../../hooks/useRuntimeClientState.js';
import type { ChatSkillSelectionRequest, MainView } from '../../types/app.js';
import { latestBrowserOpenRequest, type BrowserOpenRequest } from '../../utils/runtimeBrowserActions.js';

export function AppRouteContent({
  activeProject,
  activeWorkspace,
  activeView,
  chatActions,
  draft,
  projectWorkspace,
  runtime,
  setActiveView,
  setDraft,
  skillSelectionRequest,
  updater,
  workspacePanels,
  onSelectSkillForChat,
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
  draft: string;
  projectWorkspace: ProjectWorkspaceState;
  runtime: RuntimeClientState;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setDraft: Dispatch<SetStateAction<string>>;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  updater: DesktopUpdaterStateView;
  workspacePanels: DesktopWorkspacePanelsState;
  onSelectSkillForChat: (skillId: string) => void;
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
  const selectedSkillCount = runtime.skills.filter((skill) => skill.enabled && skill.selected).length;
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{ path: string; version: number } | null>(null);
  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null);
  const browserOpenSequenceRef = useRef(0);
  const handledBrowserOpenRequestIdRef = useRef<string | null>(null);
  const pendingBrowserOpenRequest = useMemo(
    () => latestBrowserOpenRequest(runtime.activityEvents),
    [runtime.activityEvents],
  );
  const { openDesktopPanel } = workspacePanels;

  useEffect(() => window.setsunaDesktop?.browser.onOpenNewTab(({ url }) => {
    browserOpenSequenceRef.current += 1;
    setBrowserOpenRequest({ id: `desktop-browser-${Date.now()}-${browserOpenSequenceRef.current}`, url });
    openDesktopPanel('side', 'browser');
  }), [openDesktopPanel]);

  useEffect(() => {
    if (!pendingBrowserOpenRequest || handledBrowserOpenRequestIdRef.current === pendingBrowserOpenRequest.id) return;
    handledBrowserOpenRequestIdRef.current = pendingBrowserOpenRequest.id;
    setBrowserOpenRequest(pendingBrowserOpenRequest);
    openDesktopPanel('side', 'browser');
  }, [openDesktopPanel, pendingBrowserOpenRequest]);
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
    if (!workspaceRoot) throw new Error('当前工作区不可用。');
    const reviewApi = window.setsunaDesktop?.desktopReview;
    if (!reviewApi) throw new Error('当前环境不支持撤销文件改动。');
    await reviewApi.discardUnstaged(workspaceRoot, filePaths);
    await workspacePanels.loadReviewState();
  };

  if (activeView === 'settings') {
    return (
        <SettingsPage
          archivedThreads={runtime.archivedThreads}
          config={runtime.config}
          projects={runtime.projects}
          skillExtraRoots={runtime.skillExtraRoots}
          updater={updater}
          usage={runtime.usage}
          memoryPreview={runtime.memoryPreview}
        memoryPreviewLoading={runtime.memoryPreviewLoading}
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
    );
  }

  if (activeView === 'capabilities') {
    return (
      <CapabilitiesPage
        skills={runtime.skills}
        selectedSkillCount={selectedSkillCount}
        mcpState={runtime.mcpState}
        hookState={runtime.hookState}
        onCreateHook={runtime.createHook}
        onCreateSkill={runtime.createSkill}
        onDeleteSkill={runtime.deleteSkill}
        onGetSkillDetail={runtime.getSkillDetail}
        onCreateInConversation={onSelectSkillForChat}
        onRefresh={runtime.refresh}
        onUpdateSkill={runtime.updateSkill}
        onFetchMcpTools={runtime.fetchMcpServerTools}
        onRefreshHooks={runtime.refreshHooks}
        onSaveMcpServer={runtime.saveMcpServer}
        onTrustHook={runtime.trustHook}
        onUpdateHook={runtime.updateHook}
        onUpdateHookEnabled={runtime.updateHookEnabled}
        onDeleteHook={runtime.deleteHook}
        onUpdateMcpServer={runtime.updateMcpServer}
        onDeleteMcpServer={(server) => void runtime.deleteMcpServer(server)}
      />
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
      browserOpenRequest={browserOpenRequest}
      canClearContext={Boolean(runtime.currentThread?.messages.length)}
      config={runtime.config}
      contextCompacting={runtime.contextCompacting}
      currentThread={runtime.currentThread}
      draft={draft}
      filePreview={projectWorkspace.filePreview}
      skillSelectionRequest={skillSelectionRequest}
      reviewError={workspacePanels.reviewError}
      reviewFocusRequest={reviewFocusRequest}
      reviewLoading={workspacePanels.reviewLoading}
      reviewState={workspacePanels.reviewState}
      selectedWorkspaceApp={workspacePanels.selectedWorkspaceApp}
      skills={runtime.skills}
      threadUsage={runtime.threadUsage}
      threads={runtime.threads}
      sideActivePanel={workspacePanels.sideActivePanel}
      sidePanelSlot={workspacePanels.sidePanelSlot}
      sideChatClient={runtime.client}
      onReloadThreads={runtime.reloadThreads}
      onSideChatError={runtime.setError}
      sidePanelVisible={workspacePanels.sidePanelVisible}
      terminalSessionsByPanelId={workspacePanels.terminalSessionsByPanelId}
      onActivateBottomPanel={(panelId) => workspacePanels.activateDesktopPanel('bottom', panelId)}
      onAddFileToConversation={chatActions.addFileToConversation}
      onCancelActiveTurn={() => void chatActions.cancelActiveTurn()}
      onApprovalPolicyChange={(policy) => void runtime.saveRuntimePreferences({ approvalPolicy: policy })}
      onAnswerApproval={(approvalId, input) => runtime.answerApproval(approvalId, input)}
      onCompactContext={() => void runtime.compactCurrentThreadContext()}
      onClearContext={() => void runtime.clearCurrentThreadContext()}
      onClearThreadGoal={() => runtime.clearCurrentThreadGoal()}
      onThreadMemoryModeChange={(mode) => void runtime.updateCurrentThreadMemoryMode(mode)}
      onDeleteMessages={(messageIds) => chatActions.deleteMessages(messageIds)}
      onDiscardFileChanges={discardFileChanges}
      onCloseBottomPanel={(panelId) => workspacePanels.closeDesktopPanelItem('bottom', panelId)}
      onCloseBottomSlot={() => workspacePanels.closeDesktopPanelSlot('bottom')}
      onDraftChange={setDraft}
      onEditUserMessage={(messageId, content) => chatActions.editUserMessage(messageId, content)}
      onExternalOpenFile={(filePath, line) => void workspacePanels.openFileInWorkspaceApp(filePath, line)}
      onSelectModel={(providerId, modelId) => void runtime.selectProviderModel(providerId, modelId)}
      onGoRoot={() => {
        projectWorkspace.setFilePreview(null);
      }}
      onSearchProjectEntries={projectWorkspace.searchProjectEntries}
      onOpenBottomReviewPanel={() => {
        workspacePanels.openDesktopPanel('bottom', 'review');
        void workspacePanels.loadReviewState();
      }}
      onOpenBottomTerminalPanel={() => workspacePanels.openDesktopPanel('bottom', 'terminal')}
      onOpenBrowser={() => workspacePanels.openDesktopPanel('side', 'browser')}
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
      onReorderBottomPanels={(panelId, targetPanelId, placement) => workspacePanels.reorderDesktopPanel('bottom', panelId, targetPanelId, placement)}
      onReviewRefresh={(options) => workspacePanels.loadReviewState(options)}
      onSetMultiAgentEnabled={(enabled) => runtime.saveRuntimePreferences({
        features: {
          ...(runtime.config?.features ?? {}),
          multi_agent: enabled,
          multi_agent_v2: enabled,
        },
      })}
      onStartThreadReview={() => runtime.startCurrentThreadReview({ type: 'uncommittedChanges' })}
      onSend={(value, options) => void chatActions.sendInput(value, options)}
      onPlanDecision={(decision) => void chatActions.sendInput('', { planDecision: decision })}
      onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
      onTerminalResizeStep={onTerminalResizeStep}
      onTerminalResizeStart={onTerminalResizeStart}
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
