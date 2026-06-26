import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  RuntimeApprovalDecision,
  RuntimeThread,
  RuntimeConfigState,
  RuntimeSkillSummary,
  WorkspaceEntry,
  WorkspaceEntrySearchItem,
  WorkspaceFileRead,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChatWorkspace } from '../chat/ChatWorkspace.js';
import { BottomToolsPanel } from '../workspace/BottomToolsPanel.js';
import { WorkspacePanel } from '../workspace/WorkspacePanel.js';
import type {
  DesktopPanelSlotState,
  DesktopPanelTab,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
} from '../workspace/model.js';
import { latestDesktopReviewSummaryFromMessages } from '../workspace/runtimeReviewSummary.js';

export function AppChatSurface({
  activeProject,
  activeTurnId,
  bottomActivePanel,
  bottomPanelSlot,
  bottomPanelVisible,
  canClearContext,
  config,
  contextCompacting,
  currentThread,
  draft,
  filePreview,
  reviewError,
  reviewLoading,
  reviewState,
  selectedWorkspaceApp,
  skills,
  sideActivePanel,
  sidePanelVisible,
  terminalSessionsByPanelId,
  onActivateBottomPanel,
  onAddFileToConversation,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onAnswerApproval,
  onCompactContext,
  onClearContext,
  onDeleteMessages,
  onDiscardFileChanges,
  onCloseBottomPanel,
  onCloseBottomSlot,
  onDraftChange,
  onEditUserMessage,
  onExternalOpenFile,
  onSelectModel,
  onGoRoot,
  onSearchProjectEntries,
  onOpenBottomReviewPanel,
  onOpenBottomTerminalPanel,
  onOpenFileReviewPanel,
  onPermissionProfileChange,
  onOpenEntry,
  onOpenProjectFile,
  onReviewRefresh,
  onSend,
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
  activeTurnId: string | null;
  bottomActivePanel?: DesktopPanelTab | null;
  bottomPanelSlot: DesktopPanelSlotState;
  bottomPanelVisible: boolean;
  canClearContext: boolean;
  config: RuntimeConfigState | null;
  contextCompacting: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  filePreview: WorkspaceFileRead | null;
  reviewError: string | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  skills: RuntimeSkillSummary[];
  sideActivePanel?: DesktopPanelTab | null;
  sidePanelVisible: boolean;
  terminalSessionsByPanelId: Record<string, DesktopTerminalSession>;
  onActivateBottomPanel: (panelId: string) => void;
  onAddFileToConversation: (filePath: string) => void;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onCloseBottomPanel: (panelId: string) => void;
  onCloseBottomSlot: () => void;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onGoRoot: () => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchItem[]>;
  onOpenBottomReviewPanel: () => void;
  onOpenBottomTerminalPanel: () => void;
  onOpenFileReviewPanel?: () => void;
  onPermissionProfileChange: (profile: RuntimeConfigState['permissionProfile']) => void;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string) => void;
  onReviewRefresh: () => void;
  onSend: (value?: string, options?: { attachments?: RuntimeThread['messages'][number]['attachments']; skillIds?: string[] }) => void;
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
  const latestReviewSummary = useMemo(
    () => latestDesktopReviewSummaryFromMessages(currentThread?.messages ?? []),
    [currentThread?.messages],
  );

  return (
    <>
      <ChatWorkspace
        activeTurnId={activeTurnId}
        activeProject={activeProject}
        canClearContext={canClearContext}
        contextCompacting={contextCompacting}
        config={config}
        currentThread={currentThread}
        draft={draft}
        skills={skills}
        onCancelActiveTurn={onCancelActiveTurn}
        onApprovalPolicyChange={onApprovalPolicyChange}
        onAnswerApproval={onAnswerApproval}
        onCompactContext={onCompactContext}
        onClearContext={onClearContext}
        onDeleteMessages={onDeleteMessages}
        onDiscardFileChanges={onDiscardFileChanges}
        onDraftChange={onDraftChange}
        onEditUserMessage={onEditUserMessage}
        onOpenFileReview={onOpenFileReviewPanel}
        onPermissionProfileChange={onPermissionProfileChange}
        onSelectModel={onSelectModel}
        onSearchProjectEntries={onSearchProjectEntries}
        onSend={onSend}
      />
      {sidePanelVisible && sideActivePanel ? (
        <WorkspacePanel
          activePanel={sideActivePanel}
          activeProject={activeProject}
          filePreview={filePreview}
          reviewError={reviewError}
          latestReviewSummary={latestReviewSummary}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          selectedWorkspaceApp={selectedWorkspaceApp}
          terminalSession={terminalSessionsByPanelId[sideActivePanel.id] ?? null}
          onAddFileToConversation={onAddFileToConversation}
          onExternalOpenFile={onExternalOpenFile}
          onSearchProjectEntries={onSearchProjectEntries}
          onOpenEntry={onOpenEntry}
          onOpenProjectFile={onOpenProjectFile}
          onGoRoot={onGoRoot}
          onReviewRefresh={onReviewRefresh}
          onResizeStep={onWorkspaceResizeStep}
          onResizeStart={onWorkspaceResizeStart}
          resizeMax={workspaceMaxWidth}
          resizeMin={workspaceMinWidth}
          resizeValue={workspaceWidth}
        />
      ) : null}
      {bottomPanelVisible && bottomActivePanel ? (
        <BottomToolsPanel
          activePanel={bottomActivePanel}
          panels={bottomPanelSlot.panels}
          reviewError={reviewError}
          latestReviewSummary={latestReviewSummary}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          activeProject={activeProject}
          terminalSession={terminalSessionsByPanelId[bottomActivePanel.id] ?? null}
          onActivatePanel={onActivateBottomPanel}
          onClosePanel={onCloseBottomPanel}
          onCloseSlot={onCloseBottomSlot}
          onExternalOpenFile={onExternalOpenFile}
          onOpenProjectFile={onOpenProjectFile}
          onOpenReviewPanel={onOpenBottomReviewPanel}
          onOpenTerminalPanel={onOpenBottomTerminalPanel}
          onReviewRefresh={onReviewRefresh}
          onResizeStep={onTerminalResizeStep}
          onResizeStart={onTerminalResizeStart}
          resizeMax={terminalMaxHeight}
          resizeMin={terminalMinHeight}
          resizeValue={terminalHeight}
        />
      ) : null}
    </>
  );
}
