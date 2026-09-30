import type {
  WorkspaceFileChangeAction,
  ThreadFileChangesResult,
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeSkillReference,
  RuntimeThread,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import {
  chatComposerSlot,
  chatConversationSlot,
  chatDetailsSlot,
} from '@setsuna-desktop/renderer-contracts/chat';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatCapabilitySelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../../app/types.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type {
  DesktopReviewOpenHandler,
  DesktopReviewState,
} from '../workspace/model.js';
import type { ChatAttachmentStore } from './composer/chatAttachmentStore.js';
import type { ChatComposerSendOptions } from './composer/chatComposerSendOptions.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatModelSetupNotice } from './ChatModelSetupNotice.js';
import type { ChatModelSelectionHandler } from './chatModelSelection.js';
import { useConversationOverviewLayout } from './conversation/ChatWorkspaceScroll.js';
import { ConversationOverviewPanel } from './conversation/ConversationOverviewPanel.js';
import type { AnswerApprovalHandler, ChatStarterPresentation } from './conversation/chat-workspace-types.js';
import { ChatStarter, ChatStarterContent } from './conversation/ChatStarter.js';
import { activeModelContextBudget, contextTokenUsageFromThread } from './conversation/chatContextUsage.js';
import { conversationOverviewFromMessages } from './conversation/chatConversationOverview.js';
import { ChatTranscript } from './conversation/ChatTranscript.js';
import type { ChatQueuedTurnActions } from './hooks/useQueuedTurnInputActions.js';
import { useModelSetupNotice } from './hooks/useModelSetupNotice.js';
import { useChatStarterTransition } from './hooks/useChatStarterTransition.js';
import { useChatSendPresentation } from './hooks/useChatSendPresentation.js';
import { useThreadMessageHistory } from './hooks/useThreadMessageHistory.js';
import { RendererOwnedSingleSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';

export function ChatWorkspace({
  activeTurnId,
  activeProject,
  canClearContext,
  client,
  composerKey,
  attachmentStore,
  config,
  conversationOverviewVisibility = 'auto',
  contextCompacting = false,
  currentThread,
  draft,
  draftSkillReferences,
  focusComposerOnReveal = false,
  focusComposerRequest = 0,
  findInChatRequest,
  onFindInChatRequestConsumed,
  imageAttachmentRequest,
  capabilitySelectionRequest,
  workspaceMentionRequest,
  skills,
  onCancelActiveTurn,
  onAccessModeChange,
  onAnswerApproval,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onCompactContext,
  onClearContext,
  onDeleteMessages,
  onFileChangesAction,
  onDraftChange,
  onEditUserMessage,
  onOpenSideChat,
  onOpenFileReview,
  onOpenModelSettings,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
  queuedTurnActions,
  onSetMultiAgentEnabled,
  onStartThreadReview,
  onImageAttachmentRequestConsumed,
  onCapabilitySelectionRequestConsumed,
  onWorkspaceMentionRequestConsumed,
  reviewControls,
  starterControls,
  starterPresentation,
  reviewError = null,
  reviewState = null,
  plugins = [],
  variant = 'main',
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  canClearContext: boolean;
  client: DesktopRuntimeClient;
  composerKey: string;
  attachmentStore?: ChatAttachmentStore;
  config: RuntimeConfigState | null;
  conversationOverviewVisibility?: ConversationOverviewVisibility;
  contextCompacting?: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  draftSkillReferences?: RuntimeSkillReference[];
  focusComposerOnReveal?: boolean;
  focusComposerRequest?: number;
  findInChatRequest?: number;
  onFindInChatRequestConsumed?(requestId: number): void;
  imageAttachmentRequest?: ChatImageAttachmentRequest | null;
  capabilitySelectionRequest: ChatCapabilitySelectionRequest | null;
  workspaceMentionRequest?: ChatWorkspaceMentionRequest | null;
  skills: RuntimeSkillSummary[];
  onCancelActiveTurn: () => void;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onConversationOverviewRenderedChange?: (visible: boolean) => void;
  onFocusComposerRequestConsumed?: (requestId: number) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onFileChangesAction?: (toolCallIds: string[], action: WorkspaceFileChangeAction) => void | Promise<void | ThreadFileChangesResult>;
  onDraftChange: (value: string, skillReferences?: RuntimeSkillReference[]) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onOpenSideChat?: () => void;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenModelSettings?: () => void;
  onSelectModel: ChatModelSelectionHandler;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onSend: (value?: string, options?: ChatComposerSendOptions) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: (
    target: ReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => Promise<unknown>;
  onImageAttachmentRequestConsumed?: (requestId: number, outcome: ChatImageAttachmentOutcome) => void;
  onCapabilitySelectionRequestConsumed: (requestId: number) => void;
  onWorkspaceMentionRequestConsumed?: (requestId: number) => void;
  reviewControls?: ReactNode;
  starterControls?: ReactNode;
  starterPresentation?: ChatStarterPresentation;
  reviewError?: string | null;
  reviewState?: DesktopReviewState | null;
  plugins?: RuntimePluginSummary[];
  variant?: 'main' | 'side';
}) {
  const messageHistory = useThreadMessageHistory(client, currentThread);
  const messages = messageHistory.messages;
  const { pendingMessages, sendInput, submitting } = useChatSendPresentation({
    activeTurnId, composerKey, currentThread, draft, messages, onSend,
  });
  const historyThread = useMemo(
    () => currentThread ? { ...currentThread, messages } : null,
    [currentThread, messages],
  );
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const [deleteModeActive, setDeleteModeActive] = useState(false);
  const showThinkingInTranscript = config?.desktopSettings?.showThinkingInTranscript === true;
  const contextUsage = useMemo(() => contextTokenUsageFromThread(
    historyThread,
    activeModelContextBudget(config, historyThread),
  ), [config, historyThread]);
  const contextCompactionRunning = contextCompacting || currentThread?.contextCompaction?.status === 'running';
  const conversationOverview = useMemo(() => (variant === 'main' && currentThread ? conversationOverviewFromMessages(messages, activeTurnId) : null), [activeTurnId, currentThread, messages, variant]);
  const overviewLayout = useConversationOverviewLayout(conversationRef, contentNode);
  const overviewVisible = conversationOverviewVisibility === 'shown'
    || (conversationOverviewVisibility === 'auto' && overviewLayout !== 'hidden');
  const overviewShiftsContent = overviewVisible && overviewLayout === 'shifted';
  const starterSourceVisible = variant === 'main' && !activeTurnId && !pendingMessages.length
    && (starterPresentation?.visible ?? messages.length === 0);
  const starterIdentity = currentThread?.id ?? composerKey;
  const starterTransition = useChatStarterTransition({
    conversationRef,
    sourceVisible: starterSourceVisible,
    starterKey: starterIdentity,
  });
  const {
    begin: beginStarterTransition,
    cancel: cancelStarterTransition,
    composerHeight: starterComposerHeight,
    offsetY: starterOffsetY,
    phase: starterSettlePhase,
    starterKey,
    visible: starterTransitionVisible,
  } = starterTransition;
  // Task setup leaves its starter immediately, even while the first submission is still pending.
  const showEmptyStarter = starterPresentation ? starterSourceVisible : starterTransitionVisible;
  const { modelSetupNoticeVisible, dismissModelSetupNotice } = useModelSetupNotice(config);
  const modelSetupNotice = showEmptyStarter && modelSetupNoticeVisible && onOpenModelSettings ? (
    <ChatModelSetupNotice onConfigure={onOpenModelSettings} onDismiss={dismissModelSetupNotice} />
  ) : null;
  const conversationClassName = [
    'chat-main-conversation',
    showEmptyStarter ? '' : 'chat-main-conversation--with-transcript',
    showEmptyStarter || deleteModeActive ? '' : 'chat-main-conversation--with-bottom-sender',
    conversationOverview && overviewShiftsContent ? 'chat-main-conversation--overview-shifted' : '',
  ].filter(Boolean).join(' ');
  useEffect(() => {
    onConversationOverviewRenderedChange?.(Boolean(conversationOverview && currentThread && overviewVisible));
  }, [conversationOverview, currentThread, onConversationOverviewRenderedChange, overviewVisible]);
  const handleSend = useCallback<NonNullable<typeof onSend>>(
    async (value, options) => {
      // 发送消息代表用户重新关注最新进度；同时恢复 sticky，后续流式内容会持续贴底。
      scrollToBottomRef.current?.();
      if (!starterPresentation) beginStarterTransition();
      try {
        const sent = await sendInput(value, options);
        if (!sent) cancelStarterTransition();
        return sent;
      } catch (error) {
        cancelStarterTransition();
        throw error;
      }
    },
    [beginStarterTransition, cancelStarterTransition, sendInput, starterPresentation],
  );
  const surfaceInstanceId = `${variant}:${currentThread?.id ?? activeProject?.id ?? 'new'}`;
  const composerSurfaceInstanceId = `${variant}:${composerKey}`;
  const composer = (starter = false) => (
    <RendererOwnedSingleSlot
      instanceKey={composerSurfaceInstanceId}
      slot={chatComposerSlot}
      props={{
        surfaceInstanceId: composerSurfaceInstanceId,
        renderDefault: () => (
          <ChatComposer
            key={composerKey}
            attachmentStore={attachmentStore}
            activeTurnId={activeTurnId}
            activeProject={activeProject}
            canClearContext={canClearContext}
            client={client}
            contextCompacting={contextCompactionRunning}
            contextUsage={contextUsage}
            config={config}
            currentThread={historyThread}
            draft={draft}
            draftSkillReferences={draftSkillReferences}
            focusOnReveal={focusComposerOnReveal}
            focusRequest={focusComposerRequest}
            onFocusRequestConsumed={onFocusComposerRequestConsumed}
            imageAttachmentRequest={imageAttachmentRequest}
            capabilitySelectionRequest={capabilitySelectionRequest}
            workspaceMentionRequest={workspaceMentionRequest}
            skills={skills}
            plugins={plugins}
            sideConversation={variant === 'side'}
            starter={starter}
            submissionPending={submitting}
            onCancelActiveTurn={onCancelActiveTurn}
            onAccessModeChange={onAccessModeChange}
            onCompactContext={onCompactContext}
            onClearContext={onClearContext}
            onDraftChange={onDraftChange}
            onSelectModel={onSelectModel}
            onSearchProjectEntries={onSearchProjectEntries}
            onOpenSideChat={onOpenSideChat}
            onSetMultiAgentEnabled={onSetMultiAgentEnabled}
            onSend={handleSend}
            queuedTurnActions={queuedTurnActions}
            onStartThreadReview={onStartThreadReview}
            onImageAttachmentRequestConsumed={onImageAttachmentRequestConsumed}
            onCapabilitySelectionRequestConsumed={onCapabilitySelectionRequestConsumed}
            onWorkspaceMentionRequestConsumed={onWorkspaceMentionRequestConsumed}
          />
        ),
      }}
    />
  );
  const conversation = (renderDefault: () => ReactNode) => (
    <RendererOwnedSingleSlot
      instanceKey={surfaceInstanceId}
      slot={chatConversationSlot}
      props={{ surfaceInstanceId, renderDefault }}
    />
  );
  return (
    <main className={`chat-main-panel desktop-chat-panel ${variant === 'side' ? 'desktop-chat-panel--side' : ''}`}>
      <div className="chat-main-workspace">
        <div className={conversationClassName} ref={conversationRef}>
          {showEmptyStarter ? (
            <div className="chat-messages chat-messages--starter">
              <div className="chat-content-frame" ref={setContentNode}>
                <ChatStarter
                  key={starterKey}
                  composer={composer(true)}
                  contextBar={!starterPresentation && (!currentThread || starterSettlePhase) ? starterControls : undefined}
                  footer={starterPresentation?.footer}
                  settleComposerHeight={starterComposerHeight}
                  settleOffsetY={starterOffsetY}
                  settlePhase={starterSettlePhase}
                >
                  {conversation(() => starterPresentation ? <>
                    {starterPresentation.content}
                    {modelSetupNotice ? <div className="chat-starter__notice chat-starter__reveal chat-starter__reveal--notice">{modelSetupNotice}</div> : null}
                  </> : (
                    <ChatStarterContent
                      modelSetupNotice={modelSetupNotice}
                      projectName={activeProject?.name}
                    />
                  ))}
                </ChatStarter>
              </div>
            </div>
          ) : conversation(() => (
            <ChatTranscript
              findRequest={findInChatRequest}
              onFindRequestConsumed={onFindInChatRequestConsumed}
              activeTurnId={activeTurnId}
              contextCompactionRunning={contextCompactionRunning}
              contentRef={contentRef}
              onContentNodeChange={setContentNode}
              currentThread={currentThread}
              messageHistory={messageHistory}
              messages={messages}
              pendingMessages={pendingMessages}
              plugins={plugins}
              scrollToBottomRef={scrollToBottomRef}
              showThinkingInTranscript={showThinkingInTranscript}
              skills={skills}
              onAnswerApproval={onAnswerApproval}
              onDeleteMessages={onDeleteMessages}
              onDeleteModeChange={setDeleteModeActive}
              onFileChangesAction={onFileChangesAction}
              onEditUserMessage={onEditUserMessage}
              onOpenFileReview={onOpenFileReview}
            />
          ))}
          {overviewVisible && conversationOverview && currentThread ? (
            <div className="chat-conversation-overview">
              <RendererOwnedSingleSlot
                instanceKey={surfaceInstanceId}
                slot={chatDetailsSlot}
                props={{
                  surfaceInstanceId,
                  renderDefault: () => (
                    <ConversationOverviewPanel
                      activeProject={activeProject}
                      overview={conversationOverview}
                      reviewControls={reviewControls}
                      reviewError={reviewError}
                      reviewState={reviewState}
                      onOpenReview={onOpenFileReview}
                      currentThread={currentThread}
                    />
                  ),
                }}
              />
            </div>
          ) : null}
          {showEmptyStarter || deleteModeActive ? null : composer()}
        </div>
      </div>
    </main>
  );
}
