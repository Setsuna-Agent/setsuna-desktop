import {
  runtimeDeveloperFeaturesEnabled,
  type AnswerRuntimeApprovalInput,
  type DesktopRuntimeClient,
  type RuntimeCollaborationMode,
  type RuntimeConfigState,
  type RuntimePlanDecision,
  type RuntimePluginSummary,
  type RuntimeSkillSummary,
  type RuntimeThread,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadSummary,
  type RuntimeUsageResponse,
  type WorkspaceEntry,
  type WorkspaceEntrySearchItem,
  type WorkspaceEntrySearchResponse,
  type WorkspaceFileRead,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { ChatWorkspace } from '../../features/chat/ChatWorkspace.js';
import { SideChatPanel } from '../../features/chat/SideChatPanel.js';
import {
  RuntimePluginNavigationProvider,
  type OpenRuntimePluginHandler,
} from '../../features/chat/artifacts/RuntimePluginNavigation.js';
import { useChatImageAttachmentRequest } from '../../features/chat/hooks/useChatImageAttachmentRequest.js';
import type { ChatQueuedTurnActions } from '../../features/chat/hooks/useQueuedTurnInputActions.js';
import { MarkdownNavigationProvider } from '../../features/chat/markdown/MarkdownNavigationProvider.js';
import { WorkspaceGitCommitProvider } from '../../features/workspace/git/WorkspaceGitCommitDialog.js';
import type { DesktopBrowserPanelInstance } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { WorkspaceFileDraftState } from '../../features/workspace/hooks/useWorkspaceFileDraft.js';
import type {
  DesktopPanelDropPlacement,
  DesktopPanelSlotState,
  DesktopPanelTab,
  DesktopPanelTabPatch,
  DesktopReviewFocusRequest,
  DesktopReviewLoadOptions,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
} from '../../features/workspace/model.js';
import { latestDesktopReviewSummaryFromMessages } from '../../features/workspace/runtimeReviewSummary.js';
import { workspaceFileMentionEntry } from '../../features/workspace/workspaceFileMention.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type {
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../types.js';

const ConversationDebugPanel = lazy(async () => {
  const module = await import('../../features/conversation-debug/ConversationDebugPanel.js');
  return { default: module.ConversationDebugPanel };
});
const BottomToolsPanel = lazy(async () => {
  const module = await import('../../features/workspace/BottomToolsPanel.js');
  return { default: module.BottomToolsPanel };
});
const BrowserPanel = lazy(async () => {
  const module = await import('../../features/workspace/BrowserPanel.js');
  return { default: module.BrowserPanel };
});
const WorkspacePanel = lazy(async () => {
  const module = await import('../../features/workspace/WorkspacePanel.js');
  return { default: module.WorkspacePanel };
});

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
  focusComposerRequest,
  fileDraft,
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
  onAccessModeChange,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onAnswerApproval,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onUpdateThreadGoal,
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
  onOpenConversationDebug,
  onOpenMarkdownWebLink,
  onOpenPlugin,
  onOpenFilesPanel,
  onOpenModelSettings,
  onOpenThread,
  onOpenFileReviewPanel,
  onOpenSideChat,
  onOpenSideTerminalPanel,
  onOpenEntry,
  onOpenProjectFile,
  onOpenWorkspaceDirectory,
  onReorderBottomPanels,
  onReloadThreads,
  onReviewRefresh,
  onRevealFile,
  onSideChatError,
  onSetMultiAgentEnabled,
  onStartThreadReview,
  onSend,
  queuedTurnActions,
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
  focusComposerRequest: number;
  fileDraft: WorkspaceFileDraftState;
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
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onConversationOverviewRenderedChange: (visible: boolean) => void;
  onFocusComposerRequestConsumed: (requestId: number) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onUpdateThreadGoal: (patch: RuntimeThreadGoalPatch) => void | Promise<unknown>;
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
  onOpenConversationDebug: () => void;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenPlugin: OpenRuntimePluginHandler;
  onOpenFilesPanel: () => void;
  onOpenModelSettings: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onOpenFileReviewPanel?: (filePath?: string) => void;
  onOpenSideChat: () => void;
  onOpenSideTerminalPanel: () => void;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string) => void;
  onOpenWorkspaceDirectory: (directoryPath: string) => void;
  onReorderBottomPanels: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onReloadThreads: () => Promise<unknown>;
  onReviewRefresh: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
  onRevealFile: (filePath: string) => void;
  onSideChatError: Dispatch<SetStateAction<string | null>>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: () => void | Promise<unknown>;
  onSend: (value?: string, options?: { attachments?: RuntimeThread['messages'][number]['attachments']; collaborationMode?: RuntimeCollaborationMode; goalMode?: boolean; planDecision?: RuntimePlanDecision; skillIds?: string[]; skillReferences?: RuntimeThread['messages'][number]['skillReferences']; thinking?: boolean; thinkingEffort?: string }) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
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
    <WorkspaceGitCommitProvider
      activeProject={activeWorkspace}
      reviewLoading={reviewLoading}
      reviewState={reviewState}
      onReviewRefresh={onReviewRefresh}
    >
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        <MarkdownNavigationProvider
          onOpenInAppBrowser={onOpenBrowser}
          onOpenWebLink={onOpenMarkdownWebLink}
          workspaceRoot={activeWorkspace?.path}
          onOpenWorkspaceDirectory={onOpenWorkspaceDirectory}
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
            focusComposerRequest={focusComposerRequest}
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
            onAccessModeChange={onAccessModeChange}
            onConversationOverviewRenderedChange={onConversationOverviewRenderedChange}
            onFocusComposerRequestConsumed={onFocusComposerRequestConsumed}
            onAnswerApproval={onAnswerApproval}
            onCompactContext={onCompactContext}
            onClearContext={onClearContext}
            onClearThreadGoal={onClearThreadGoal}
            onUpdateThreadGoal={onUpdateThreadGoal}
            onDeleteMessages={onDeleteMessages}
            onDiscardFileChanges={onDiscardFileChanges}
            onDraftChange={onDraftChange}
            onEditUserMessage={onEditUserMessage}
            onOpenSideChat={onOpenSideChat}
            onOpenThread={onOpenThread}
            onOpenFileReview={onOpenFileReviewPanel}
            onOpenModelSettings={onOpenModelSettings}
            onSearchProjectEntries={onSearchProjectEntries}
            onSelectModel={onSelectModel}
            onSend={onSend}
            queuedTurnActions={queuedTurnActions}
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
            onAccessModeChange={onAccessModeChange}
            onError={onSideChatError}
            onOpenWorkspaceFile={openChatWorkspaceFile}
            onOpenWorkspaceDirectory={onOpenWorkspaceDirectory}
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
          <Suspense fallback={null} key={instance.panel.id}>
            <PersistentBrowserPanel
              instance={instance}
              onPanelMetadataChange={onUpdateBrowserPanel}
              onScreenshotAttachment={requestImageAttachment}
              onResizeStep={onWorkspaceResizeStep}
              onResizeStart={onWorkspaceResizeStart}
              resizeMax={workspaceMaxWidth}
              resizeMin={workspaceMinWidth}
              resizeValue={workspaceWidth}
            />
          </Suspense>
        ))}
        {sidePanelVisible && sideActivePanel && sideActivePanel.type !== 'browser' && sideActivePanel.type !== 'chat' ? (
          sideActivePanel.type === 'conversation-debug' ? (
            runtimeDeveloperFeaturesEnabled(config) ? (
              <Suspense fallback={null}>
                <ConversationDebugPanel
                  client={runtimeClient}
                  thread={currentThread}
                  onResizeStep={onWorkspaceResizeStep}
                  onResizeStart={onWorkspaceResizeStart}
                  resizeMax={workspaceMaxWidth}
                  resizeMin={workspaceMinWidth}
                  resizeValue={workspaceWidth}
                />
              </Suspense>
            ) : null
          ) : (
            <Suspense fallback={null}>
              <WorkspacePanel
                activePanel={sideActivePanel}
                activeProject={activeWorkspace}
                fileDraft={fileDraft}
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
                onOpenConversationDebug={runtimeDeveloperFeaturesEnabled(config) ? onOpenConversationDebug : undefined}
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
            </Suspense>
          )
        ) : null}
        {bottomPanelVisible && bottomActivePanel ? (
          <Suspense fallback={null}>
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
          </Suspense>
        ) : null}
      </RuntimePluginNavigationProvider>
    </WorkspaceGitCommitProvider>
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
