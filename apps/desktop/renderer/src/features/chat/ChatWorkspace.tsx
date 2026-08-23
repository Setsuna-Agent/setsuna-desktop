import type {
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimePluginSummary,
  RuntimeReviewTarget,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeUsageResponse,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import setsunaAppIconUrl from '../../shared/assets/setsuna-app.png';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../../app/types.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type {
  DesktopReviewOpenHandler,
  DesktopReviewState,
} from '../workspace/model.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatModelSetupNotice } from './ChatModelSetupNotice.js';
import type { ChatModelSelectionHandler } from './chatModelSelection.js';
import {
  conversationOverviewContextLabel,
  useConversationOverviewAutoExpand,
  useConversationOverviewContentCollision,
} from './conversation/ChatWorkspaceScroll.js';
import { ConversationOverviewPanel } from './conversation/ConversationOverviewPanel.js';
import type { AnswerApprovalHandler } from './conversation/chat-workspace-types.js';
import { activeModelContextWindowTokens, contextTokenUsageFromThread } from './conversation/chatContextUsage.js';
import { conversationOverviewFromMessages } from './conversation/chatConversationOverview.js';
import { ChatTranscript } from './conversation/ChatTranscript.js';
import { chatThreadUsageForDisplay } from './conversation/chatThreadUsage.js';
import {
  shouldAutoHideConversationOverview,
  shouldCompactConversationOverview,
  shouldShiftConversationOverviewContent,
} from './conversation/conversationOverviewLayout.js';
import type { ChatQueuedTurnActions } from './hooks/useQueuedTurnInputActions.js';
import { useModelSetupNotice } from './hooks/useModelSetupNotice.js';
import { useThreadMessageHistory } from './hooks/useThreadMessageHistory.js';

export function ChatWorkspace({
  activeTurnId,
  activeProject,
  canClearContext,
  client,
  composerKey,
  config,
  conversationOverviewShowRequest = 0,
  conversationOverviewVisibility = 'auto',
  contextCompacting = false,
  currentThread,
  draft,
  focusComposerOnReveal = false,
  focusComposerRequest = 0,
  imageAttachmentRequest,
  skillSelectionRequest,
  workspaceMentionRequest,
  skills,
  threadUsage,
  onCancelActiveTurn,
  onAccessModeChange,
  onAnswerApproval,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onCompactContext,
  onClearContext,
  onDeleteMessages,
  onDiscardFileChanges,
  onDraftChange,
  onEditUserMessage,
  onOpenSideChat,
  onOpenFileReview,
  onOpenModelSettings,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
  queuedTurnActions,
  onReviewRefresh,
  onSetMultiAgentEnabled,
  onStartThreadReview,
  onImageAttachmentRequestConsumed,
  onSkillSelectionRequestConsumed,
  onWorkspaceMentionRequestConsumed,
  reviewError = null,
  reviewLoading = false,
  reviewState = null,
  plugins = [],
  variant = 'main',
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  canClearContext: boolean;
  client: DesktopRuntimeClient;
  composerKey: string;
  config: RuntimeConfigState | null;
  conversationOverviewShowRequest?: number;
  conversationOverviewVisibility?: ConversationOverviewVisibility;
  contextCompacting?: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  focusComposerOnReveal?: boolean;
  focusComposerRequest?: number;
  imageAttachmentRequest?: ChatImageAttachmentRequest | null;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  workspaceMentionRequest?: ChatWorkspaceMentionRequest | null;
  skills: RuntimeSkillSummary[];
  threadUsage: RuntimeUsageResponse | null;
  onCancelActiveTurn: () => void;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onConversationOverviewRenderedChange?: (visible: boolean) => void;
  onFocusComposerRequestConsumed?: (requestId: number) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onOpenSideChat?: () => void;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenModelSettings?: () => void;
  onSelectModel: ChatModelSelectionHandler;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessage['attachments']; goalMode?: boolean; skillIds?: string[]; skillReferences?: RuntimeMessage['skillReferences']; thinking?: boolean; thinkingEffort?: string }) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
  onReviewRefresh?: () => void | Promise<void>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: (
    target: RuntimeReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => Promise<unknown>;
  onImageAttachmentRequestConsumed?: (requestId: number, outcome: ChatImageAttachmentOutcome) => void;
  onSkillSelectionRequestConsumed: (requestId: number) => void;
  onWorkspaceMentionRequestConsumed?: (requestId: number) => void;
  reviewError?: string | null;
  reviewLoading?: boolean;
  reviewState?: DesktopReviewState | null;
  plugins?: RuntimePluginSummary[];
  variant?: 'main' | 'side';
}) {
  const { t } = useI18n();
  const messageHistory = useThreadMessageHistory(client, currentThread);
  const messages = messageHistory.messages;
  const historyThread = useMemo(
    () => currentThread ? { ...currentThread, messages } : null,
    [currentThread, messages],
  );
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const [deleteModeActive, setDeleteModeActive] = useState(false);
  const showThinkingInTranscript = config?.desktopSettings?.showThinkingInTranscript === true;
  const contextUsage = useMemo(() => contextTokenUsageFromThread(
    historyThread,
    activeModelContextWindowTokens(config, historyThread),
  ), [config, historyThread]);
  const displayedThreadUsage = useMemo(() => chatThreadUsageForDisplay(threadUsage, currentThread), [currentThread, threadUsage]);
  const contextCompactionRunning = contextCompacting || currentThread?.contextCompaction?.status === 'running';
  const conversationOverview = useMemo(() => (variant === 'main' && currentThread ? conversationOverviewFromMessages(messages) : null), [currentThread, messages, variant]);
  const overviewLayout = useConversationOverviewAutoExpand(conversationRef, contentRef);
  const overviewCanExpand = overviewLayout.canExpand;
  const [overviewManuallyCollapsed, setOverviewManuallyCollapsed] = useState(false);
  const [overviewManuallyExpanded, setOverviewManuallyExpanded] = useState(false);
  const overviewCompact = shouldCompactConversationOverview({
    canExpand: overviewCanExpand,
    manuallyCollapsed: overviewManuallyCollapsed,
    manuallyExpanded: overviewManuallyExpanded,
  });
  const overviewRequested = conversationOverviewVisibility !== 'hidden';
  const overviewOverlapsContent = useConversationOverviewContentCollision(
    conversationRef,
    contentRef,
    overviewRef,
    overviewCompact && overviewRequested && Boolean(conversationOverview && currentThread),
  );
  const overviewAutoHidden = shouldAutoHideConversationOverview({
    compact: overviewCompact,
    explicitlyShown: conversationOverviewVisibility === 'shown',
    overlapsContent: overviewOverlapsContent,
  });
  const overviewVisible = overviewRequested && !overviewAutoHidden;
  const overviewShiftsContent = overviewVisible && shouldShiftConversationOverviewContent({
    canExpand: overviewCanExpand,
    compact: overviewCompact,
    needsShift: overviewLayout.needsContentShift,
  });
  const overviewContextLabel = useMemo(
    () => conversationOverviewContextLabel(contextUsage, currentThread?.contextCompaction?.status, t),
    [contextUsage, currentThread?.contextCompaction?.status, t],
  );
  const showEmptyStarter = variant === 'main' && messages.length === 0 && !activeTurnId;
  const { modelSetupNoticeVisible, dismissModelSetupNotice } = useModelSetupNotice(config);
  const modelSetupNotice = showEmptyStarter && modelSetupNoticeVisible && onOpenModelSettings ? (
    <ChatModelSetupNotice onConfigure={onOpenModelSettings} onDismiss={dismissModelSetupNotice} />
  ) : null;
  const conversationClassName = ['chat-main-conversation', showEmptyStarter || deleteModeActive ? '' : 'chat-main-conversation--with-bottom-sender', conversationOverview && overviewShiftsContent ? 'chat-main-conversation--overview-shifted' : ''].filter(Boolean).join(' ');
  useEffect(() => {
    setOverviewManuallyCollapsed(false);
    setOverviewManuallyExpanded(false);
  }, [activeProject?.id, conversationOverviewShowRequest, conversationOverviewVisibility, currentThread?.id]);
  useEffect(() => {
    onConversationOverviewRenderedChange?.(Boolean(conversationOverview && currentThread && overviewVisible));
  }, [conversationOverview, currentThread, onConversationOverviewRenderedChange, overviewVisible]);
  const handleSend = useCallback<NonNullable<typeof onSend>>(
    (value, options) => {
      // 发送消息代表用户重新关注最新进度；同时恢复 sticky，后续流式内容会持续贴底。
      scrollToBottomRef.current?.();
      return onSend(value, options);
    },
    [onSend],
  );
  const composer = (starter = false) => (
    <ChatComposer
      key={composerKey}
      activeTurnId={activeTurnId}
      activeProject={activeProject}
      canClearContext={canClearContext}
      client={client}
      contextCompacting={contextCompactionRunning}
      contextUsage={contextUsage}
      config={config}
      currentThread={currentThread}
      draft={draft}
      focusOnReveal={focusComposerOnReveal}
      focusRequest={focusComposerRequest}
      onFocusRequestConsumed={onFocusComposerRequestConsumed}
      imageAttachmentRequest={imageAttachmentRequest}
      skillSelectionRequest={skillSelectionRequest}
      workspaceMentionRequest={workspaceMentionRequest}
      skills={skills}
      sideConversation={variant === 'side'}
      starter={starter}
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
      onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
      onWorkspaceMentionRequestConsumed={onWorkspaceMentionRequestConsumed}
    />
  );
  const starterTitle = activeProject
    ? t('chat.starter.projectTitle', { project: activeProject.name })
    : t('chat.starter.title');
  return (
    <main className={`chat-main-panel desktop-chat-panel ${variant === 'side' ? 'desktop-chat-panel--side' : ''}`}>
      <div className="chat-main-workspace">
        <div className={conversationClassName} ref={conversationRef}>
          <ChatTranscript
            activeTurnId={activeTurnId}
            contextCompactionRunning={contextCompactionRunning}
            contentRef={contentRef}
            currentThread={currentThread}
            messageHistory={messageHistory}
            messages={messages}
            plugins={plugins}
            reviewState={reviewState}
            scrollToBottomRef={scrollToBottomRef}
            showEmptyStarter={showEmptyStarter}
            showThinkingInTranscript={showThinkingInTranscript}
            skills={skills}
            starterContent={showEmptyStarter ? (
              <ChatStarter composer={composer(true)} modelSetupNotice={modelSetupNotice} title={starterTitle} />
            ) : undefined}
            onAnswerApproval={onAnswerApproval}
            onDeleteMessages={onDeleteMessages}
            onDeleteModeChange={setDeleteModeActive}
            onDiscardFileChanges={onDiscardFileChanges}
            onEditUserMessage={onEditUserMessage}
            onOpenFileReview={onOpenFileReview}
          />
          {overviewRequested && conversationOverview && currentThread ? (
            <div
              aria-hidden={overviewAutoHidden || undefined}
              className={`chat-conversation-overview ${overviewAutoHidden ? 'is-auto-hidden' : ''}`}
              ref={overviewRef}
            >
              <ConversationOverviewPanel
                activeProject={activeProject}
                compact={overviewCompact}
                contextLabel={overviewContextLabel}
                contextPercent={contextUsage.visiblePercent || contextUsage.percent}
                overview={conversationOverview}
                shellProcessClient={client}
                reviewError={reviewError}
                reviewLoading={reviewLoading}
                reviewState={reviewState}
                onCollapse={() => {
                  setOverviewManuallyCollapsed(true);
                  setOverviewManuallyExpanded(false);
                }}
                onExpand={() => {
                  setOverviewManuallyCollapsed(false);
                  setOverviewManuallyExpanded(!overviewCanExpand);
                }}
                onOpenReview={onOpenFileReview}
                onReviewRefresh={onReviewRefresh}
                currentThread={currentThread}
                threadUsage={displayedThreadUsage}
              />
            </div>
          ) : null}
          {showEmptyStarter || deleteModeActive ? null : composer()}
        </div>
      </div>
    </main>
  );
}

function ChatStarter({ composer, modelSetupNotice, title }: { composer: ReactNode; modelSetupNotice?: ReactNode; title: string }) {
  return (
    <div className="chat-starter">
      <div className="chat-starter__intro">
        <div className="chat-starter__heading">
          <img className="chat-starter__system-icon" src={setsunaAppIconUrl} alt="" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        {modelSetupNotice}
      </div>
      {composer}
    </div>
  );
}
