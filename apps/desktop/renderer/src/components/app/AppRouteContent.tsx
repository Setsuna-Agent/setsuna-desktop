import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { CapabilitiesPage } from '../pages/CapabilitiesPage.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { AppChatSurface } from './AppChatSurface.js';
import type { ChatTurnActions } from '../../hooks/useChatTurnActions.js';
import type { DesktopWorkspacePanelsState } from '../../hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../hooks/useProjectWorkspace.js';
import type { RuntimeClientState } from '../../hooks/useRuntimeClientState.js';
import type { MainView } from '../../types/app.js';

export function AppRouteContent({
  activeProject,
  activeView,
  chatActions,
  draft,
  memoryDraft,
  projectWorkspace,
  runtime,
  setActiveView,
  setDraft,
  setMemoryDraft,
  workspacePanels,
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
  memoryDraft: string;
  projectWorkspace: ProjectWorkspaceState;
  runtime: RuntimeClientState;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setMemoryDraft: Dispatch<SetStateAction<string>>;
  workspacePanels: DesktopWorkspacePanelsState;
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
        usage={runtime.usage}
        memories={runtime.memories}
        memoryDraft={memoryDraft}
        activeProject={activeProject}
        onBack={() => setActiveView('chat')}
        onFetchProviderModels={runtime.fetchProviderModels}
        onSaveProviders={runtime.saveProviders}
        onSaveRuntimePreferences={runtime.saveRuntimePreferences}
        onMemoryDraftChange={setMemoryDraft}
        onSaveMemory={() => {
          void runtime.saveMemory(memoryDraft, runtime.currentThread?.id).then(() => setMemoryDraft(''));
        }}
        onDeleteMemory={(memory) => void runtime.deleteMemory(memory)}
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
        onRefresh={runtime.refresh}
        onUpdateSkill={runtime.updateSkill}
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
      onAnswerApproval={(approvalId, decision) => void runtime.answerApproval(approvalId, { decision })}
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
      onOpenFileReviewPanel={openFileReviewPanel}
      onPermissionProfileChange={(permissionProfile) => void runtime.saveRuntimePreferences({ permissionProfile })}
      onOpenEntry={(entry) => void projectWorkspace.openEntry(entry)}
      onOpenProjectFile={(filePath) => void projectWorkspace.openProjectFile(filePath)}
      onReviewRefresh={() => void workspacePanels.loadReviewState()}
      onSend={(value, options) => void chatActions.sendInput(value, options)}
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
