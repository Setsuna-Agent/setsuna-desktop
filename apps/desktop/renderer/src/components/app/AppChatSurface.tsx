import { useCallback, useMemo, useRef, useState, type ComponentProps, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeCollaborationMode,
  RuntimeThread,
  RuntimeConfigState,
  RuntimePlanDecision,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceEntry,
  WorkspaceEntrySearchItem,
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
import { workspaceFileMentionEntry } from '../workspace/WorkspaceFileContextMenu.js';
import type { ChatSkillSelectionRequest, ChatWorkspaceMentionRequest, ConversationOverviewVisibility } from '../../types/app.js';
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
import type { DesktopBrowserPanelInstance } from '../../hooks/useDesktopWorkspacePanels.js';

type AnswerApprovalHandler = (approvalId: string, input: AnswerRuntimeApprovalInput) => void | Promise<void>;
type BrowserPanelMetadataHandler = (
  targetIdentity: DesktopBrowserPanelInstance['targetIdentity'],
  panelId: string,
  patch: DesktopPanelTabPatch,
) => void;

export function AppChatSurface({
  activeProject,
  activeWorkspace,
  activeTurnId,
  bottomActivePanel,
  bottomPanelSlot,
  bottomPanelVisible,
  browserPanelInstances,
  canClearContext,
  composerKey,
  config,
  conversationOverviewShowRequest,
  conversationOverviewVisibility,
  contextCompacting,
  currentThread,
  draft,
  filePreview,
  plugins,
  skillSelectionRequest,
  reviewError,
  reviewFocusRequest,
  reviewLoading,
  reviewState,
  selectedWorkspaceApp,
  workspaceApps,
  skills,
  threadUsage,
  threads,
  sideActivePanel,
  sidePanelSlot,
  runtimeClient,
  sidePanelVisible,
  terminalSessionsByPanelId,
  onActivateBottomPanel,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onConversationOverviewRenderedChange,
  onAnswerApproval,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onThreadMemoryModeChange,
  onDeleteMessages,
  onDiscardFileChanges,
  onCloseBottomPanel,
  onCloseBottomSlot,
  onCopyFilePath,
  onDraftChange,
  onEditUserMessage,
  onExternalOpenFile,
  onOpenFileWithApp,
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
  onRevealFile,
  onSideChatError,
  onSetMultiAgentEnabled,
  onStartThreadReview,
  onSend,
  onPlanDecision,
  onSkillSelectionRequestConsumed,
  onTerminalResizeStep,
  onTerminalResizeStart,
  onUpdateBrowserPanel,
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
  browserPanelInstances: DesktopBrowserPanelInstance[];
  canClearContext: boolean;
  composerKey: string;
  config: RuntimeConfigState | null;
  conversationOverviewShowRequest: number;
  conversationOverviewVisibility: ConversationOverviewVisibility;
  contextCompacting: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  filePreview: WorkspaceFileRead | null;
  plugins: RuntimePluginSummary[];
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  reviewError: string | null;
  reviewFocusRequest: DesktopReviewFocusRequest | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  skills: RuntimeSkillSummary[];
  threadUsage: RuntimeUsageResponse | null;
  threads: RuntimeThreadSummary[];
  sideActivePanel?: DesktopPanelTab | null;
  sidePanelSlot: DesktopPanelSlotState;
  runtimeClient: DesktopRuntimeClient;
  sidePanelVisible: boolean;
  terminalSessionsByPanelId: Record<string, DesktopTerminalSession>;
  onActivateBottomPanel: (panelId: string) => void;
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onConversationOverviewRenderedChange: (visible: boolean) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onCloseBottomPanel: (panelId: string) => void;
  onCloseBottomSlot: () => void;
  onCopyFilePath: (filePath: string) => void;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenBottomReviewPanel: () => void;
  onOpenBottomTerminalPanel: () => void;
  onOpenBrowser: (url?: string) => void;
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
  onRevealFile: (filePath: string) => void;
  onSideChatError: Dispatch<SetStateAction<string | null>>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: () => void | Promise<unknown>;
  onSend: (value?: string, options?: { attachments?: RuntimeThread['messages'][number]['attachments']; collaborationMode?: RuntimeCollaborationMode; goalMode?: boolean; planDecision?: RuntimePlanDecision; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string }) => Promise<boolean>;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onSkillSelectionRequestConsumed: (requestId: number) => void;
  onTerminalResizeStep: (delta: number) => void;
  onTerminalResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onUpdateBrowserPanel: BrowserPanelMetadataHandler;
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
  } = useChatImageAttachmentRequest(composerKey);
  const [scopedWorkspaceMentionRequest, setScopedWorkspaceMentionRequest] = useState<{
    composerKey: string;
    request: ChatWorkspaceMentionRequest;
  } | null>(null);
  const workspaceMentionRequestIdRef = useRef(0);
  const workspaceMentionRequest = scopedWorkspaceMentionRequest?.composerKey === composerKey
    ? scopedWorkspaceMentionRequest.request
    : null;
  const requestWorkspaceMention = useCallback((entry: WorkspaceEntrySearchItem) => {
    workspaceMentionRequestIdRef.current += 1;
    setScopedWorkspaceMentionRequest({
      composerKey,
      request: { entry, requestId: workspaceMentionRequestIdRef.current },
    });
  }, [composerKey]);
  const requestWorkspaceFileMention = useCallback(
    (filePath: string) => requestWorkspaceMention(workspaceFileMentionEntry(filePath)),
    [requestWorkspaceMention],
  );
  const consumeWorkspaceMentionRequest = useCallback((requestId: number) => {
    setScopedWorkspaceMentionRequest((current) => current?.request.requestId === requestId ? null : current);
  }, []);
  const latestReviewSummary = useMemo(
    () => latestDesktopReviewSummaryFromMessages(currentThread?.messages ?? []),
    [currentThread?.messages],
  );
  const openChatWorkspaceFile = selectedWorkspaceApp ? onExternalOpenFile : onOpenProjectFile;

  return (
    <>
      <MarkdownNavigationProvider
        onOpenInAppBrowser={onOpenBrowser}
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={activeWorkspace?.path}
        onOpenWorkspaceFile={openChatWorkspaceFile}
      >
        <ChatWorkspace
          activeTurnId={activeTurnId}
          activeProject={activeWorkspace}
          canClearContext={canClearContext}
          client={runtimeClient}
          composerKey={composerKey}
          conversationOverviewShowRequest={conversationOverviewShowRequest}
          conversationOverviewVisibility={conversationOverviewVisibility}
          contextCompacting={contextCompacting}
          config={config}
          currentThread={currentThread}
          draft={draft}
          imageAttachmentRequest={imageAttachmentRequest}
          plugins={plugins}
          reviewError={reviewError}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          skillSelectionRequest={skillSelectionRequest}
          workspaceMentionRequest={workspaceMentionRequest}
          skills={skills}
          threadUsage={threadUsage}
          threads={threads}
          onCancelActiveTurn={onCancelActiveTurn}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onConversationOverviewRenderedChange={onConversationOverviewRenderedChange}
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
          onSearchProjectEntries={onSearchProjectEntries}
          onSelectModel={onSelectModel}
          onSend={onSend}
          onPlanDecision={onPlanDecision}
          onReviewRefresh={onReviewRefresh}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onStartThreadReview={onStartThreadReview}
          onImageAttachmentRequestConsumed={resolveImageAttachmentRequest}
          onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
          onWorkspaceMentionRequestConsumed={consumeWorkspaceMentionRequest}
        />
      </MarkdownNavigationProvider>
      {sidePanelSlot.panels.filter((panel) => panel.type === 'chat').map((panel) => (
        <SideChatPanel
          activeProjectId={activeProject?.id ?? null}
          activeWorkspace={activeWorkspace}
          client={runtimeClient}
          config={config}
          hidden={!sidePanelVisible || sideActivePanel?.id !== panel.id}
          key={panel.id}
          plugins={plugins}
          selectedWorkspaceApp={selectedWorkspaceApp}
          skills={skills}
          threads={threads}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onError={onSideChatError}
          onOpenWorkspaceFile={openChatWorkspaceFile}
          onOpenMarkdownWebLink={onOpenMarkdownWebLink}
          onOpenInAppBrowser={onOpenBrowser}
          onOpenSideChat={onOpenSideChat}
          onReloadThreads={onReloadThreads}
          onSelectModel={onSelectModel}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onWorkspaceResizeStep={onWorkspaceResizeStep}
          onWorkspaceResizeStart={onWorkspaceResizeStart}
          workspaceMaxWidth={workspaceMaxWidth}
          workspaceMinWidth={workspaceMinWidth}
          workspaceWidth={workspaceWidth}
        />
      ))}
      {browserPanelInstances.map((instance) => (
        <PersistentBrowserPanel
          instance={instance}
          key={instance.panel.id}
          onPanelMetadataChange={onUpdateBrowserPanel}
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
          workspaceApps={workspaceApps}
          terminalSession={terminalSessionsByPanelId[sideActivePanel.id] ?? null}
          onAddFileToConversation={requestWorkspaceMention}
          onCopyFilePath={onCopyFilePath}
          onExternalOpenFile={onExternalOpenFile}
          onOpenFileWithApp={onOpenFileWithApp}
          onSearchProjectEntries={onSearchProjectEntries}
          onOpenEntry={onOpenEntry}
          onOpenProjectFile={onOpenProjectFile}
          onOpenFilesPanel={onOpenFilesPanel}
          onOpenBrowser={onOpenBrowser}
          onOpenReviewPanel={onOpenFileReviewPanel}
          onOpenSideChat={onOpenSideChat}
          onOpenTerminalPanel={onOpenSideTerminalPanel}
          onReviewRefresh={onReviewRefresh}
          onRevealFile={onRevealFile}
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
          workspaceApps={workspaceApps}
          activeProject={activeWorkspace}
          terminalSession={terminalSessionsByPanelId[bottomActivePanel.id] ?? null}
          onAddFileToConversation={requestWorkspaceFileMention}
          onActivatePanel={onActivateBottomPanel}
          onClosePanel={onCloseBottomPanel}
          onCloseSlot={onCloseBottomSlot}
          onCopyFilePath={onCopyFilePath}
          onExternalOpenFile={onExternalOpenFile}
          onOpenFileWithApp={onOpenFileWithApp}
          onOpenProjectFile={onOpenProjectFile}
          onOpenReviewPanel={onOpenBottomReviewPanel}
          onOpenTerminalPanel={onOpenBottomTerminalPanel}
          onReorderPanels={onReorderBottomPanels}
          onReviewRefresh={onReviewRefresh}
          onRevealFile={onRevealFile}
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

function PersistentBrowserPanel({
  instance,
  onPanelMetadataChange,
  ...panelProps
}: {
  instance: DesktopBrowserPanelInstance;
  onPanelMetadataChange: BrowserPanelMetadataHandler;
} & Omit<ComponentProps<typeof BrowserPanel>, 'hidden' | 'onPanelMetadataChange' | 'panel'>) {
  const updatePanelMetadata = useCallback((panelId: string, patch: DesktopPanelTabPatch) => {
    onPanelMetadataChange(instance.targetIdentity, panelId, patch);
  }, [instance.targetIdentity, onPanelMetadataChange]);

  return (
    <BrowserPanel
      {...panelProps}
      hidden={!instance.active}
      panel={instance.panel}
      onPanelMetadataChange={updatePanelMetadata}
    />
  );
}
