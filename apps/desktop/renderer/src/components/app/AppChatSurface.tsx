import { useMemo, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeCollaborationMode,
  RuntimeThread,
  RuntimeConfigState,
  RuntimePlanDecision,
  RuntimeSkillSummary,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceEntry,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChatWorkspace } from '../chat/ChatWorkspace.js';
import { SideChatPanel } from '../chat/SideChatPanel.js';
import { MarkdownNavigationProvider } from '../chat/markdown/MarkdownNavigationProvider.js';
import { BottomToolsPanel } from '../workspace/BottomToolsPanel.js';
import { BrowserPanel } from '../workspace/BrowserPanel.js';
import { WorkspacePanel } from '../workspace/WorkspacePanel.js';
import type { ChatSkillSelectionRequest } from '../../types/app.js';
import type {
  DesktopPanelSlotState,
  DesktopPanelTab,
  DesktopPanelTabPatch,
  DesktopPanelDropPlacement,
  DesktopReviewFocusRequest,
  DesktopReviewLoadOptions,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
} from '../workspace/model.js';
import { latestDesktopReviewSummaryFromMessages } from '../workspace/runtimeReviewSummary.js';
import { useChatImageAttachmentRequest } from '../../hooks/useChatImageAttachmentRequest.js';

type AnswerApprovalHandler = (approvalId: string, input: AnswerRuntimeApprovalInput) => void | Promise<void>;

export function AppChatSurface({
  activeProject,
  activeWorkspace,
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
  skillSelectionRequest,
  reviewError,
  reviewFocusRequest,
  reviewLoading,
  reviewState,
  selectedWorkspaceApp,
  skills,
  threadUsage,
  threads,
  sideActivePanel,
  sidePanelSlot,
  sideChatClient,
  sidePanelVisible,
  terminalSessionsByPanelId,
  onActivateBottomPanel,
  onAddFileToConversation,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onAnswerApproval,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onThreadMemoryModeChange,
  onDeleteMessages,
  onDiscardFileChanges,
  onCloseBottomPanel,
  onCloseBottomSlot,
  onDraftChange,
  onEditUserMessage,
  onExternalOpenFile,
  onSelectModel,
  onSearchProjectEntries,
  onOpenBottomReviewPanel,
  onOpenBottomTerminalPanel,
  onOpenBrowser,
  onOpenMarkdownWebLink,
  onOpenFilesPanel,
  onOpenThread,
  onOpenFileReviewPanel,
  onOpenSideChat,
  onOpenSideTerminalPanel,
  onOpenEntry,
  onOpenProjectFile,
  onReorderBottomPanels,
  onReloadThreads,
  onReviewRefresh,
  onSideChatError,
  onSetMultiAgentEnabled,
  onStartThreadReview,
  onSend,
  onPlanDecision,
  onSkillSelectionRequestConsumed,
  onTerminalResizeStep,
  onTerminalResizeStart,
  onUpdateSidePanel,
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
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  reviewError: string | null;
  reviewFocusRequest: DesktopReviewFocusRequest | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  skills: RuntimeSkillSummary[];
  threadUsage: RuntimeUsageResponse | null;
  threads: RuntimeThreadSummary[];
  sideActivePanel?: DesktopPanelTab | null;
  sidePanelSlot: DesktopPanelSlotState;
  sideChatClient: DesktopRuntimeClient;
  sidePanelVisible: boolean;
  terminalSessionsByPanelId: Record<string, DesktopTerminalSession>;
  onActivateBottomPanel: (panelId: string) => void;
  onAddFileToConversation: (filePath: string) => void;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onCloseBottomPanel: (panelId: string) => void;
  onCloseBottomSlot: () => void;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenBottomReviewPanel: () => void;
  onOpenBottomTerminalPanel: () => void;
  onOpenBrowser: () => void;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenFilesPanel: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onOpenFileReviewPanel?: (filePath?: string) => void;
  onOpenSideChat: () => void;
  onOpenSideTerminalPanel: () => void;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string) => void;
  onReorderBottomPanels: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onReloadThreads: () => Promise<unknown>;
  onReviewRefresh: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
  onSideChatError: Dispatch<SetStateAction<string | null>>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: () => void | Promise<unknown>;
  onSend: (value?: string, options?: { attachments?: RuntimeThread['messages'][number]['attachments']; collaborationMode?: RuntimeCollaborationMode; goalMode?: boolean; planDecision?: RuntimePlanDecision; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string }) => void;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onSkillSelectionRequestConsumed: (requestId: number) => void;
  onTerminalResizeStep: (delta: number) => void;
  onTerminalResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateSidePanel: (panelId: string, patch: DesktopPanelTabPatch) => void;
  terminalHeight: number;
  terminalMaxHeight: number;
  terminalMinHeight: number;
  onWorkspaceResizeStep: (delta: number) => void;
  onWorkspaceResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}) {
  const {
    imageAttachmentRequest,
    requestImageAttachment,
    resolveImageAttachmentRequest,
  } = useChatImageAttachmentRequest();
  const latestReviewSummary = useMemo(
    () => latestDesktopReviewSummaryFromMessages(currentThread?.messages ?? []),
    [currentThread?.messages],
  );

  return (
    <>
      <MarkdownNavigationProvider
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={activeWorkspace?.path}
        onOpenWorkspaceFile={onOpenProjectFile}
      >
        <ChatWorkspace
          activeTurnId={activeTurnId}
          activeProject={activeWorkspace}
          canClearContext={canClearContext}
          contextCompacting={contextCompacting}
          config={config}
          currentThread={currentThread}
          draft={draft}
          imageAttachmentRequest={imageAttachmentRequest}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          skillSelectionRequest={skillSelectionRequest}
          skills={skills}
          threadUsage={threadUsage}
          threads={threads}
          onCancelActiveTurn={onCancelActiveTurn}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onAnswerApproval={onAnswerApproval}
          onCompactContext={onCompactContext}
          onClearContext={onClearContext}
          onClearThreadGoal={onClearThreadGoal}
          onThreadMemoryModeChange={onThreadMemoryModeChange}
          onDeleteMessages={onDeleteMessages}
          onDiscardFileChanges={onDiscardFileChanges}
          onDraftChange={onDraftChange}
          onEditUserMessage={onEditUserMessage}
          onOpenSideChat={onOpenSideChat}
          onOpenThread={onOpenThread}
          onOpenFileReview={onOpenFileReviewPanel}
          onSelectModel={onSelectModel}
          onSearchProjectEntries={onSearchProjectEntries}
          onSend={onSend}
          onPlanDecision={onPlanDecision}
          onReviewRefresh={onReviewRefresh}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onStartThreadReview={onStartThreadReview}
          onImageAttachmentRequestConsumed={resolveImageAttachmentRequest}
          onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
        />
      </MarkdownNavigationProvider>
      {sidePanelSlot.panels.filter((panel) => panel.type === 'chat').map((panel) => (
        <SideChatPanel
          activeProjectId={activeProject?.id ?? null}
          activeWorkspace={activeWorkspace}
          client={sideChatClient}
          config={config}
          hidden={!sidePanelVisible || sideActivePanel?.id !== panel.id}
          key={panel.id}
          skills={skills}
          threads={threads}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onError={onSideChatError}
          onOpenProjectFile={onOpenProjectFile}
          onOpenMarkdownWebLink={onOpenMarkdownWebLink}
          onOpenSideChat={onOpenSideChat}
          onReloadThreads={onReloadThreads}
          onSearchProjectEntries={onSearchProjectEntries}
          onSelectModel={onSelectModel}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onWorkspaceResizeStep={onWorkspaceResizeStep}
          onWorkspaceResizeStart={onWorkspaceResizeStart}
          workspaceMaxWidth={workspaceMaxWidth}
          workspaceMinWidth={workspaceMinWidth}
          workspaceWidth={workspaceWidth}
        />
      ))}
      {sidePanelSlot.panels.filter((panel) => panel.type === 'browser').map((panel) => (
        <BrowserPanel
          hidden={!sidePanelVisible || sideActivePanel?.id !== panel.id}
          key={panel.id}
          panel={panel}
          onPanelMetadataChange={onUpdateSidePanel}
          onScreenshotAttachment={requestImageAttachment}
          onResizeStep={onWorkspaceResizeStep}
          onResizeStart={onWorkspaceResizeStart}
          resizeMax={workspaceMaxWidth}
          resizeMin={workspaceMinWidth}
          resizeValue={workspaceWidth}
        />
      ))}
      {sidePanelVisible && sideActivePanel && sideActivePanel.type !== 'browser' && sideActivePanel.type !== 'chat' ? (
        <WorkspacePanel
          activePanel={sideActivePanel}
          activeProject={activeWorkspace}
          filePreview={filePreview}
          reviewError={reviewError}
          reviewFocusRequest={reviewFocusRequest}
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
          onOpenFilesPanel={onOpenFilesPanel}
          onOpenBrowser={onOpenBrowser}
          onOpenReviewPanel={onOpenFileReviewPanel}
          onOpenSideChat={onOpenSideChat}
          onOpenTerminalPanel={onOpenSideTerminalPanel}
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
          reviewFocusRequest={reviewFocusRequest}
          latestReviewSummary={latestReviewSummary}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          selectedWorkspaceApp={selectedWorkspaceApp}
          activeProject={activeWorkspace}
          terminalSession={terminalSessionsByPanelId[bottomActivePanel.id] ?? null}
          onActivatePanel={onActivateBottomPanel}
          onClosePanel={onCloseBottomPanel}
          onCloseSlot={onCloseBottomSlot}
          onExternalOpenFile={onExternalOpenFile}
          onOpenProjectFile={onOpenProjectFile}
          onOpenReviewPanel={onOpenBottomReviewPanel}
          onOpenTerminalPanel={onOpenBottomTerminalPanel}
          onReorderPanels={onReorderBottomPanels}
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
