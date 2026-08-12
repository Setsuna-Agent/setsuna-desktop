import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimePluginSummary,
  RuntimeReviewTarget,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadGoalPatch,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ArrowDown, Bug, Hammer, SearchCode, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import setsunaAppIconUrl from '../../shared/assets/setsuna-app.png';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../../app/types.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type {
  DesktopReviewLoadOptions,
  DesktopReviewOpenHandler,
  DesktopReviewState,
} from '../workspace/model.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatModelSetupNotice } from './ChatModelSetupNotice.js';
import { runtimePluginUsesByTurn } from './artifacts/runtimePluginUsage.js';
import {
  ActiveWorkPlaceholder,
  DeleteSelectionBar,
  MessageItem,
} from './conversation/ChatMessageItem.js';
import { TranscriptWindowDivider } from './conversation/TranscriptWindowDivider.js';
import {
  ChatScrollOverlay,
  conversationOverviewContextLabel,
  useConversationOverviewAutoExpand,
  useConversationOverviewContentCollision,
  usePinnedChatScroll,
} from './conversation/ChatWorkspaceScroll.js';
import { ContextCompactionStatus } from './conversation/ContextCompactionStatus.js';
import { ConversationOverviewPanel } from './conversation/ConversationOverviewPanel.js';
import { StreamingScrollPinProvider } from './conversation/StreamingScrollPinProvider.js';
import { ChatThreadProvider } from './conversation/ChatThreadProvider.js';
import type { AnswerApprovalHandler, WorkHistoryExpandedChangeHandler } from './conversation/chat-workspace-types.js';
import { activeModelContextWindowTokens, contextTokenUsageFromThread } from './conversation/chatContextUsage.js';
import { conversationOverviewFromMessages } from './conversation/chatConversationOverview.js';
import {
  activeAssistantRunItemId,
  chatDisplayItemRenderKey,
  createChatDisplayItems,
  createChatRenderWindow,
  createChatScrollSignal,
} from './conversation/chatMessageDisplay.js';
import { chatThreadUsageForDisplay } from './conversation/chatThreadUsage.js';
import {
  shouldAutoHideConversationOverview,
  shouldCompactConversationOverview,
  shouldShiftConversationOverviewContent,
} from './conversation/conversationOverviewLayout.js';
import type { ChatQueuedTurnActions } from './hooks/useQueuedTurnInputActions.js';
import { useChatMessageOperations } from './hooks/useChatMessageOperations.js';
import { useModelSetupNotice } from './hooks/useModelSetupNotice.js';
import { useThreadMessageHistory } from './hooks/useThreadMessageHistory.js';
import { MarkdownViewportProvider } from './markdown/MarkdownViewportProvider.js';
import { SkillReferenceCatalogProvider } from './skills/SkillReference.js';

type StarterSuggestion = {
  accent: 'blue' | 'green' | 'orange' | 'purple';
  icon: LucideIcon;
  labelKey: MessageKey;
  promptKey: MessageKey;
};

const starterSuggestions: StarterSuggestion[] = [
  {
    accent: 'blue',
    icon: SearchCode,
    labelKey: 'chat.starter.explore',
    promptKey: 'chat.starter.explorePrompt',
  },
  {
    accent: 'purple',
    icon: Hammer,
    labelKey: 'chat.starter.build',
    promptKey: 'chat.starter.buildPrompt',
  },
  {
    accent: 'green',
    icon: ShieldCheck,
    labelKey: 'chat.starter.review',
    promptKey: 'chat.starter.reviewPrompt',
  },
  {
    accent: 'orange',
    icon: Bug,
    labelKey: 'chat.starter.fix',
    promptKey: 'chat.starter.fixPrompt',
  },
];

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
  threads,
  onCancelActiveTurn,
  onAccessModeChange,
  onAnswerApproval,
  onConversationOverviewRenderedChange,
  onFocusComposerRequestConsumed,
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onUpdateThreadGoal,
  onDeleteMessages,
  onDiscardFileChanges,
  onDraftChange,
  onEditUserMessage,
  onOpenSideChat,
  onOpenThread,
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
  threads: RuntimeThreadSummary[];
  onCancelActiveTurn: () => void;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onAnswerApproval: AnswerApprovalHandler;
  onConversationOverviewRenderedChange?: (visible: boolean) => void;
  onFocusComposerRequestConsumed?: (requestId: number) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onUpdateThreadGoal: (patch: RuntimeThreadGoalPatch) => void | Promise<unknown>;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onOpenSideChat?: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenModelSettings?: () => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessage['attachments']; goalMode?: boolean; skillIds?: string[]; skillReferences?: RuntimeMessage['skillReferences']; thinking?: boolean; thinkingEffort?: string }) => Promise<boolean>;
  queuedTurnActions: ChatQueuedTurnActions;
  onReviewRefresh?: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: (target: RuntimeReviewTarget) => Promise<unknown>;
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
  const displayItems = useMemo(() => createChatDisplayItems(messages), [messages]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const historyScrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const contextUsage = useMemo(() => contextTokenUsageFromThread(historyThread, activeModelContextWindowTokens(config)), [config, historyThread]);
  const displayedThreadUsage = useMemo(() => chatThreadUsageForDisplay(threadUsage, currentThread), [currentThread, threadUsage]);
  const pluginUsesByTurnId = useMemo(
    () => runtimePluginUsesByTurn(historyThread, skills, plugins),
    [historyThread, plugins, skills],
  );
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
  const showEmptyStarter = variant === 'main' && displayItems.length === 0 && !activeTurnId;
  const { modelSetupNoticeVisible, dismissModelSetupNotice } = useModelSetupNotice(config);
  const modelSetupNotice = showEmptyStarter && modelSetupNoticeVisible && onOpenModelSettings ? (
    <ChatModelSetupNotice onConfigure={onOpenModelSettings} onDismiss={dismissModelSetupNotice} />
  ) : null;
  const {
    actionError,
    allDeleteSelected,
    cancelDeleteSelection,
    cancelEditingMessage,
    confirmDeleteSelection,
    deleteMode,
    deletingMessages,
    editingDraft,
    editingMessageId,
    editingSubmitting,
    selectableDeleteCount,
    selectedDeleteCount,
    selectedDeleteItemIds,
    selectedDeleteMessageIds,
    setEditingDraft,
    someDeleteSelected,
    startDeleteSelection,
    startEditingMessage,
    submitEditingMessage,
    toggleAllDeleteSelection,
    toggleDeleteSelection,
  } = useChatMessageOperations({
    activeTurnId,
    composerKey,
    currentThreadId: currentThread?.id,
    displayItems,
    onDeleteMessages,
    onEditUserMessage,
  });
  const conversationClassName = ['chat-main-conversation', showEmptyStarter || deleteMode ? '' : 'chat-main-conversation--with-bottom-sender', conversationOverview && overviewShiftsContent ? 'chat-main-conversation--overview-shifted' : ''].filter(Boolean).join(' ');
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [expandedWorkHistoryItemIds, setExpandedWorkHistoryItemIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    historyScrollAnchorRef.current = null;
    setShowFullHistory(false);
    setExpandedWorkHistoryItemIds(new Set());
  }, [activeProject?.id, currentThread?.id]);
  useLayoutEffect(() => {
    setOverviewManuallyCollapsed(false);
    setOverviewManuallyExpanded(false);
  }, [activeProject?.id, conversationOverviewShowRequest, conversationOverviewVisibility, currentThread?.id]);
  useEffect(() => {
    setOverviewManuallyExpanded(false);
    if (!overviewCanExpand) setOverviewManuallyCollapsed(false);
  }, [overviewCanExpand]);
  useEffect(() => {
    onConversationOverviewRenderedChange?.(Boolean(conversationOverview && currentThread && overviewVisible));
  }, [conversationOverview, currentThread, onConversationOverviewRenderedChange, overviewVisible]);
  const assistantItemIdByTurnId = useMemo(() => {
    const itemIdByTurnId = new Map<string, string>();
    for (const item of displayItems) {
      if (item.type !== 'assistant') continue;
      for (const segment of item.segments) {
        if (segment.turnId) itemIdByTurnId.set(segment.turnId, chatDisplayItemRenderKey(item));
      }
    }
    return itemIdByTurnId;
  }, [displayItems]);
  const handleWorkHistoryExpandedChange = useCallback<WorkHistoryExpandedChangeHandler>((itemId, expanded) => {
    setExpandedWorkHistoryItemIds((current) => {
      const alreadyExpanded = current.has(itemId);
      if (alreadyExpanded === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);
  const renderWindow = useMemo(() => createChatRenderWindow(displayItems, { activeTurnId, enabled: !deleteMode && !showFullHistory }), [activeTurnId, deleteMode, displayItems, showFullHistory]);
  const renderedDisplayItems = renderWindow.items;
  const activeAssistantItemId = useMemo(() => activeAssistantRunItemId(renderedDisplayItems, activeTurnId), [activeTurnId, renderedDisplayItems]);
  const activeAssistantVisible = Boolean(activeAssistantItemId);
  const activeUserVisible = useMemo(() => Boolean(activeTurnId && renderedDisplayItems.some((item) => item.type === 'user' && item.message.turnId === activeTurnId)), [activeTurnId, renderedDisplayItems]);
  const showActiveTurnPlaceholder = Boolean(activeTurnId && !contextCompactionRunning && !activeAssistantVisible);
  const activePlaceholderUserItemId = useMemo(() => {
    if (!showActiveTurnPlaceholder || !activeTurnId) return null;
    return [...renderedDisplayItems].reverse().find((item) => item.type === 'user' && item.message.turnId === activeTurnId)?.id ?? null;
  }, [activeTurnId, renderedDisplayItems, showActiveTurnPlaceholder]);
  const pluginUseScrollSignal = useMemo(
    () => [...pluginUsesByTurnId].map(([turnId, uses]) => `${turnId}:${uses.map((use) => use.id).join(',')}`).join('|'),
    [pluginUsesByTurnId],
  );
  const scrollSignal = useMemo(
    () => `${createChatScrollSignal(renderWindow, { activeTurnId, contextCompactionRunning, threadId: currentThread?.id })}:plugins:${pluginUseScrollSignal}`,
    [activeTurnId, contextCompactionRunning, currentThread?.id, pluginUseScrollSignal, renderWindow],
  );
  const { handleScroll, handleScrollKeyDown, handleScrollTouchMove, handleScrollWheel, listRef, markScrollbarDragIntent, scrollRef, scrollToBottom, showScrollBottom } = usePinnedChatScroll({
    contentRef,
    scrollSignal,
    showEmptyStarter,
    threadId: currentThread?.id ?? null,
  });
  const handleSend = useCallback<NonNullable<typeof onSend>>(
    (value, options) => {
      // 发送消息代表用户重新关注最新进度；同时恢复 sticky，后续流式内容会持续贴底。
      scrollToBottom();
      return onSend(value, options);
    },
    [onSend, scrollToBottom],
  );
  const showEarlierMessages = useCallback(() => {
    const scrollNode = scrollRef.current;
    if (scrollNode) {
      historyScrollAnchorRef.current = {
        height: scrollNode.scrollHeight,
        top: scrollNode.scrollTop,
      };
    }
    setShowFullHistory(true);
    if (messageHistory.hasMore) void messageHistory.loadOlder();
  }, [messageHistory.hasMore, messageHistory.loadOlder, scrollRef]);

  useLayoutEffect(() => {
    const anchor = historyScrollAnchorRef.current;
    const scrollNode = scrollRef.current;
    if (!anchor || !scrollNode) return;
    // Prepending a page must not move the message currently under the user's cursor.
    scrollNode.scrollTop = anchor.top + (scrollNode.scrollHeight - anchor.height);
    if (!messageHistory.loading) historyScrollAnchorRef.current = null;
  }, [messageHistory.loading, messages.length, scrollRef, showFullHistory]);

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
      threadUsage={displayedThreadUsage}
      starter={starter}
      placeholder={variant === 'side' ? t('chat.composer.sidePlaceholder') : undefined}
      onCancelActiveTurn={onCancelActiveTurn}
      onAccessModeChange={onAccessModeChange}
      onCompactContext={onCompactContext}
      onClearContext={onClearContext}
      onClearThreadGoal={onClearThreadGoal}
      onUpdateThreadGoal={onUpdateThreadGoal}
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
          <div className={`chat-messages ${showEmptyStarter ? 'chat-messages--starter' : ''}`} ref={scrollRef} onKeyDownCapture={handleScrollKeyDown} onPointerDownCapture={markScrollbarDragIntent} onScroll={handleScroll} onTouchMoveCapture={handleScrollTouchMove} onWheelCapture={handleScrollWheel}>
            <MarkdownViewportProvider scrollRef={scrollRef}>
              <div className="chat-content-frame" ref={contentRef}>
                {showEmptyStarter ? (
                  <ChatStarter composer={composer(true)} modelSetupNotice={modelSetupNotice} title={starterTitle} onSelectSuggestion={onDraftChange} />
                ) : (
                  <StreamingScrollPinProvider key={currentThread?.id ?? 'no-thread'}>
                    <SkillReferenceCatalogProvider skills={skills}>
                      <div className="chat-bubble-list" ref={listRef}>
                        {renderWindow.hiddenItemCount || messageHistory.hasMore ? (
                          <TranscriptWindowDivider
                            hiddenMessageCount={renderWindow.hiddenMessageCount + messageHistory.remainingCount}
                            loading={messageHistory.loading}
                            onShowAll={showEarlierMessages}
                          />
                        ) : null}
                        {renderedDisplayItems.map((item) => (
                          <ChatThreadProvider key={chatDisplayItemRenderKey(item)} threadId={currentThread?.id ?? null}>
                            <MessageItem
                              activeAssistantItemId={activeAssistantItemId}
                              activeTurnId={activeTurnId}
                              assistantItemIdByTurnId={assistantItemIdByTurnId}
                              deleteMode={deleteMode}
                              editingDraft={editingDraft}
                              editingMessageId={editingMessageId}
                              editingSubmitting={editingSubmitting}
                              expandedWorkHistoryItemIds={expandedWorkHistoryItemIds}
                              item={item}
                              onAnswerApproval={onAnswerApproval}
                              onCancelEdit={cancelEditingMessage}
                              onDiscardFileChanges={reviewState?.isGitRepository ? onDiscardFileChanges : undefined}
                              onEditDraftChange={setEditingDraft}
                              onOpenFileReview={onOpenFileReview}
                              onStartEdit={startEditingMessage}
                              onStartDelete={startDeleteSelection}
                              onSubmitEdit={submitEditingMessage}
                              onToggleDelete={toggleDeleteSelection}
                              onWorkHistoryExpandedChange={handleWorkHistoryExpandedChange}
                              pluginUses={item.type === 'assistant' && item.turnId ? (pluginUsesByTurnId.get(item.turnId) ?? []) : []}
                              selectedForDelete={selectedDeleteItemIds.has(item.id)}
                            />
                            {item.type === 'user' && item.id === activePlaceholderUserItemId ? (
                              <ActiveWorkPlaceholder
                                segments={[item.message]}
                              />
                            ) : null}
                          </ChatThreadProvider>
                        ))}
                        {showActiveTurnPlaceholder && !activeUserVisible ? (
                          <ActiveWorkPlaceholder
                            segments={[]}
                          />
                        ) : null}
                        {contextCompactionRunning ? <ContextCompactionStatus active /> : null}
                        <div className="chat-bubble-list__bottom-spacer" aria-hidden="true" />
                      </div>
                    </SkillReferenceCatalogProvider>
                  </StreamingScrollPinProvider>
                )}
              </div>
            </MarkdownViewportProvider>
          </div>
          <ChatScrollOverlay disabled={showEmptyStarter} scrollRef={scrollRef} scrollSignal={scrollSignal} />
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
                onOpenThread={onOpenThread}
                onOpenReview={onOpenFileReview}
                onReviewRefresh={onReviewRefresh}
                currentThread={currentThread}
                threadUsage={displayedThreadUsage}
                threads={threads}
              />
            </div>
          ) : null}
          {showScrollBottom && !showEmptyStarter ? (
            <div className="chat-scroll-bottom-anchor">
              <button className="chat-scroll-bottom" type="button" aria-label={t('chat.scrollBottom')} onClick={() => scrollToBottom()}>
                <ArrowDown size={16} />
              </button>
            </div>
          ) : null}
          {actionError || messageHistory.error ? (
            <div className="chat-action-error">{actionError ?? messageHistory.error}</div>
          ) : null}
          {showEmptyStarter ? null : deleteMode ? (
            <DeleteSelectionBar
              allChecked={allDeleteSelected}
              disabled={!selectedDeleteMessageIds.length || deletingMessages}
              indeterminate={someDeleteSelected}
              loading={deletingMessages}
              selectedCount={selectedDeleteCount}
              totalCount={selectableDeleteCount}
              onCancel={cancelDeleteSelection}
              onConfirm={() => void confirmDeleteSelection()}
              onToggleAll={toggleAllDeleteSelection}
            />
          ) : (
            composer()
          )}
        </div>
      </div>
    </main>
  );
}

function ChatStarter({ composer, modelSetupNotice, title, onSelectSuggestion }: { composer: ReactNode; modelSetupNotice?: ReactNode; title: string; onSelectSuggestion: (prompt: string) => void }) {
  const { t } = useI18n();

  return (
    <div className="chat-starter">
      <div className="chat-starter__intro">
        <div className="chat-starter__heading">
          <img className="chat-starter__system-icon" src={setsunaAppIconUrl} alt="" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        {modelSetupNotice}
        <div className="chat-starter__suggestions" role="group" aria-label={t('chat.starter.suggestions')}>
          {starterSuggestions.map((suggestion) => {
            const Icon = suggestion.icon;
            return (
              <button key={suggestion.labelKey} className={`chat-starter-suggestion chat-starter-suggestion--${suggestion.accent}`} type="button" onClick={() => onSelectSuggestion(t(suggestion.promptKey))}>
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{t(suggestion.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {composer}
    </div>
  );
}
