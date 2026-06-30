import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
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

export function AppRouteContent({
  activeProject,
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
  const openFileReviewPanel = () => {
    if (!activeProject) return;
    workspacePanels.closeDesktopPanelItem('bottom', 'review');
    workspacePanels.openDesktopPanel('side', 'review');
    void workspacePanels.loadReviewState();
  };
  const discardFileChanges = async (filePaths: string[]) => {
    const workspaceRoot = activeProject?.path;
    if (!workspaceRoot) throw new Error('请先选择项目目录。');
    const reviewApi = window.setsunaDesktop?.desktopReview;
    if (!reviewApi) throw new Error('当前环境不支持撤销文件改动。');
    await reviewApi.discardUnstaged(workspaceRoot, filePaths);
    await workspacePanels.loadReviewState();
  };

  if (activeView === 'settings') {
    return (
      <SettingsPage
        config={runtime.config}
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
      />
    );
  }

  if (activeView === 'capabilities') {
    return (
      <CapabilitiesPage
        skills={runtime.skills}
        selectedSkillCount={selectedSkillCount}
        mcpState={runtime.mcpState}
        onCreateSkill={runtime.createSkill}
        onDeleteSkill={runtime.deleteSkill}
        onGetSkillDetail={runtime.getSkillDetail}
        onCreateInConversation={onSelectSkillForChat}
        onRefresh={runtime.refresh}
        onUpdateSkill={runtime.updateSkill}
        onFetchMcpTools={runtime.fetchMcpServerTools}
        onSaveMcpServer={runtime.saveMcpServer}
        onUpdateMcpServer={runtime.updateMcpServer}
        onDeleteMcpServer={(server) => void runtime.deleteMcpServer(server)}
      />
    );
  }

  return (
    <AppChatSurface
      activeProject={activeProject}
      activeTurnId={runtime.activeTurnId}
      bottomActivePanel={workspacePanels.bottomActivePanel}
      bottomPanelSlot={workspacePanels.bottomPanelSlot}
      bottomPanelVisible={workspacePanels.bottomPanelVisible}
      canClearContext={Boolean(runtime.currentThread?.messages.length)}
      config={runtime.config}
      contextCompacting={runtime.contextCompacting}
      currentThread={runtime.currentThread}
      draft={draft}
      filePreview={projectWorkspace.filePreview}
      skillSelectionRequest={skillSelectionRequest}
      reviewError={workspacePanels.reviewError}
      reviewLoading={workspacePanels.reviewLoading}
      reviewState={workspacePanels.reviewState}
      selectedWorkspaceApp={workspacePanels.selectedWorkspaceApp}
      skills={runtime.skills}
      sideActivePanel={workspacePanels.sideActivePanel}
      sidePanelVisible={workspacePanels.sidePanelVisible}
      terminalSessionsByPanelId={workspacePanels.terminalSessionsByPanelId}
      onActivateBottomPanel={(panelId) => workspacePanels.activateDesktopPanel('bottom', panelId)}
      onAddFileToConversation={chatActions.addFileToConversation}
      onCancelActiveTurn={() => void chatActions.cancelActiveTurn()}
      onApprovalPolicyChange={(policy) => void runtime.saveRuntimePreferences({ approvalPolicy: policy })}
      onAnswerApproval={(approvalId, decision) => runtime.answerApproval(approvalId, { decision })}
      onCompactContext={() => void runtime.compactCurrentThreadContext()}
      onClearContext={() => void runtime.clearCurrentThreadContext()}
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
      onOpenFilesPanel={() => {
        projectWorkspace.setFilePreview(null);
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenFileReviewPanel={openFileReviewPanel}
      onOpenSideTerminalPanel={() => workspacePanels.openDesktopPanel('side', 'terminal')}
      onOpenEntry={(entry) => void projectWorkspace.openEntry(entry)}
      onOpenProjectFile={(filePath) => void projectWorkspace.openProjectFile(filePath)}
      onReorderBottomPanels={(panelId, targetPanelId, placement) => workspacePanels.reorderDesktopPanel('bottom', panelId, targetPanelId, placement)}
      onReviewRefresh={(options) => void workspacePanels.loadReviewState(options)}
      onSend={(value, options) => void chatActions.sendInput(value, options)}
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
