import type {
  DesktopRuntimeClient,
  RuntimeCollaborationMode,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimePlanDecision,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ArrowDown, Bug, Hammer, SearchCode, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import setsunaAppIconUrl from '../../../../../../assets/build/icon.png';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../../app/types.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type { DesktopReviewLoadOptions, DesktopReviewState } from '../workspace/model.js';
import { ChatComposer } from './ChatComposer.js';
import { runtimePluginUsesByTurn } from './artifacts/runtimePluginUsage.js';
import {
  ActiveWorkPlaceholder,
  DeleteSelectionBar,
  MessageItem,
  TranscriptWindowDivider,
} from './conversation/ChatMessageItem.js';
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
import { commitChatWorkspaceOperation } from './conversation/chatWorkspaceOperationScope.js';
import {
  shouldAutoHideConversationOverview,
  shouldCompactConversationOverview,
  shouldShiftConversationOverviewContent,
} from './conversation/conversationOverviewLayout.js';
import { MarkdownViewportProvider } from './markdown/MarkdownViewportProvider.js';

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
  onCompactContext,
  onClearContext,
  onClearThreadGoal,
  onThreadMemoryModeChange,
  onDeleteMessages,
  onDiscardFileChanges,
  onDraftChange,
  onEditUserMessage,
  onOpenSideChat,
  onOpenThread,
  onOpenFileReview,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
  onPlanDecision,
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
  onCompactContext: () => void;
  onClearContext: () => void;
  onClearThreadGoal: () => void | Promise<unknown>;
  onThreadMemoryModeChange: (mode: RuntimeThreadMemoryMode) => void | Promise<void>;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onOpenSideChat?: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onOpenFileReview?: (filePath?: string) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessage['attachments']; collaborationMode?: RuntimeCollaborationMode; goalMode?: boolean; planDecision?: RuntimePlanDecision; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string }) => Promise<boolean>;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onReviewRefresh?: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onStartThreadReview: () => void | Promise<unknown>;
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
  const messages = currentThread?.messages ?? [];
  const displayItems = useMemo(() => createChatDisplayItems(messages), [messages]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const contextUsage = useMemo(() => contextTokenUsageFromThread(currentThread, activeModelContextWindowTokens(config)), [config, currentThread]);
  const displayedThreadUsage = useMemo(() => chatThreadUsageForDisplay(threadUsage, currentThread), [currentThread, threadUsage]);
  const pluginUsesByTurnId = useMemo(
    () => runtimePluginUsesByTurn(currentThread, skills, plugins),
    [currentThread, plugins, skills],
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const conversationClassName = ['chat-main-conversation', showEmptyStarter || deleteMode ? '' : 'chat-main-conversation--with-bottom-sender', conversationOverview && overviewShiftsContent ? 'chat-main-conversation--overview-shifted' : ''].filter(Boolean).join(' ');
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [selectedDeleteItemIds, setSelectedDeleteItemIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const localOperationRequests = useIdentityRequestGuard(composerKey);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [expandedWorkHistoryItemIds, setExpandedWorkHistoryItemIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
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

  useLayoutEffect(() => {
    setEditingMessageId(null);
    setEditingDraft('');
    setEditingSubmitting(false);
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setActionError(null);
  }, [currentThread?.id]);

  // 缓存可删除项，避免每次渲染都重新 filter
  const selectableDeleteItems = useMemo(
    () =>
      displayItems
        .filter((item) => item.type !== 'context' && item.type !== 'review')
        .map((item) => ({
          id: item.id,
          messageIds: item.messageIds,
          type: item.type,
        })),
    [displayItems],
  );
  // 缓存删除消息 ID 集合，避免重复计算
  const selectedDeleteMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selectableDeleteItems) {
      if (!selectedDeleteItemIds.has(item.id)) continue;
      item.messageIds.forEach((id) => ids.add(id));
    }
    return [...ids];
  }, [selectableDeleteItems, selectedDeleteItemIds]);
  const selectedDeleteCount = selectedDeleteItemIds.size;
  const allDeleteSelected = selectableDeleteItems.length > 0 && selectedDeleteCount === selectableDeleteItems.length;
  const someDeleteSelected = selectedDeleteCount > 0 && selectedDeleteCount < selectableDeleteItems.length;

  useLayoutEffect(() => {
    const validIds = new Set(selectableDeleteItems.map((item) => item.id));
    setSelectedDeleteItemIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectableDeleteItems]);

  const deleteGroupItemIds = useCallback(
    (itemId: string) => {
      const index = selectableDeleteItems.findIndex((item) => item.id === itemId);
      if (index < 0) return [itemId];
      const item = selectableDeleteItems[index];
      const ids = [item.id];
      // 默认删除完整的“提问/回答”组，避免只删一半后留下孤立 turn。
      if (item.type === 'assistant') {
        const previousUser = [...selectableDeleteItems.slice(0, index)].reverse().find((candidate) => candidate.type === 'user');
        if (previousUser) ids.push(previousUser.id);
      }
      if (item.type === 'user') {
        const nextItem = selectableDeleteItems[index + 1];
        if (nextItem?.type === 'assistant') ids.push(nextItem.id);
      }
      return ids;
    },
    [selectableDeleteItems],
  );

  const startDeleteSelection = useCallback(
    (itemId: string) => {
      if (activeTurnId) return;
      setActionError(null);
      setEditingMessageId(null);
      setEditingDraft('');
      setEditingSubmitting(false);
      setDeleteMode(true);
      setSelectedDeleteItemIds(new Set(deleteGroupItemIds(itemId)));
    },
    [activeTurnId, deleteGroupItemIds],
  );

  const toggleDeleteSelection = useCallback(
    (itemId: string, checked: boolean) => {
      const groupIds = deleteGroupItemIds(itemId);
      setSelectedDeleteItemIds((current) => {
        const next = new Set(current);
        groupIds.forEach((id) => {
          if (checked) next.add(id);
          else next.delete(id);
        });
        return next;
      });
    },
    [deleteGroupItemIds],
  );

  const toggleAllDeleteSelection = useCallback(
    (checked: boolean) => {
      setSelectedDeleteItemIds(checked ? new Set(selectableDeleteItems.map((item) => item.id)) : new Set());
    },
    [selectableDeleteItems],
  );

  const cancelDeleteSelection = useCallback(() => {
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setActionError(null);
  }, []);

  const confirmDeleteSelection = useCallback(async () => {
    const isCurrentOperation = localOperationRequests.begin();
    if (!selectedDeleteMessageIds.length) {
      setActionError(t('chat.delete.selectFirst'));
      return;
    }
    setDeletingMessages(true);
    setActionError(null);
    try {
      // 删除时传 messageIds 而不是 display item ids，因为一个 assistant item 可能包含多段消息和工具消息。
      await onDeleteMessages(selectedDeleteMessageIds);
      commitChatWorkspaceOperation(isCurrentOperation, cancelDeleteSelection);
    } catch (unknownError) {
      commitChatWorkspaceOperation(isCurrentOperation, () => {
        setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    } finally {
      commitChatWorkspaceOperation(isCurrentOperation, () => setDeletingMessages(false));
    }
  }, [cancelDeleteSelection, localOperationRequests, onDeleteMessages, selectedDeleteMessageIds, t]);

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
      imageAttachmentRequest={imageAttachmentRequest}
      skillSelectionRequest={skillSelectionRequest?.composerKey === composerKey ? skillSelectionRequest : null}
      workspaceMentionRequest={workspaceMentionRequest}
      skills={skills}
      threadUsage={displayedThreadUsage}
      starter={starter}
      threadMemoryMode={currentThread?.memoryMode}
      placeholder={variant === 'side' ? t('chat.composer.sidePlaceholder') : undefined}
      onCancelActiveTurn={onCancelActiveTurn}
      onAccessModeChange={onAccessModeChange}
      onCompactContext={onCompactContext}
      onClearContext={onClearContext}
      onClearThreadGoal={onClearThreadGoal}
      onDraftChange={onDraftChange}
      onSelectModel={onSelectModel}
      onSearchProjectEntries={onSearchProjectEntries}
      onOpenSideChat={onOpenSideChat}
      onSetMultiAgentEnabled={onSetMultiAgentEnabled}
      onSend={handleSend}
      onStartThreadReview={onStartThreadReview}
      onThreadMemoryModeChange={onThreadMemoryModeChange}
      onImageAttachmentRequestConsumed={onImageAttachmentRequestConsumed}
      onSkillSelectionRequestConsumed={onSkillSelectionRequestConsumed}
      onWorkspaceMentionRequestConsumed={onWorkspaceMentionRequestConsumed}
    />
  );
  const starterTitle = activeProject
    ? t('chat.starter.projectTitle', { project: activeProject.name })
    : t('chat.starter.title');
  const startEditingMessage = useCallback((message: RuntimeMessage) => {
    setActionError(null);
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }, []);
  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft('');
    setActionError(null);
  }, []);
  const submitEditingMessage = useCallback(
    async (messageId: string) => {
      const content = editingDraft.trim();
      if (!content) return;
      const isCurrentOperation = localOperationRequests.begin();
      setEditingSubmitting(true);
      setActionError(null);
      try {
        await onEditUserMessage(messageId, content);
        commitChatWorkspaceOperation(isCurrentOperation, cancelEditingMessage);
      } catch (unknownError) {
        commitChatWorkspaceOperation(isCurrentOperation, () => {
          setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        });
      } finally {
        commitChatWorkspaceOperation(isCurrentOperation, () => setEditingSubmitting(false));
      }
    },
    [cancelEditingMessage, editingDraft, localOperationRequests, onEditUserMessage],
  );

  return (
    <main className={`chat-main-panel desktop-chat-panel ${variant === 'side' ? 'desktop-chat-panel--side' : ''}`}>
      <div className="chat-main-workspace">
        <div className={conversationClassName} ref={conversationRef}>
          <div className={`chat-messages ${showEmptyStarter ? 'chat-messages--starter' : ''}`} ref={scrollRef} onKeyDownCapture={handleScrollKeyDown} onPointerDownCapture={markScrollbarDragIntent} onScroll={handleScroll} onTouchMoveCapture={handleScrollTouchMove} onWheelCapture={handleScrollWheel}>
            <MarkdownViewportProvider scrollRef={scrollRef}>
              <div className="chat-content-frame" ref={contentRef}>
                {showEmptyStarter ? (
                  <ChatStarter composer={composer(true)} title={starterTitle} onSelectSuggestion={onDraftChange} />
                ) : (
                  <StreamingScrollPinProvider key={currentThread?.id ?? 'no-thread'}>
                    <div className="chat-bubble-list" ref={listRef}>
                      {renderWindow.hiddenItemCount ? <TranscriptWindowDivider hiddenMessageCount={renderWindow.hiddenMessageCount} onShowAll={() => setShowFullHistory(true)} /> : null}
                      {renderedDisplayItems.map((item) => (
                        <Fragment key={chatDisplayItemRenderKey(item)}>
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
                            onPlanDecision={onPlanDecision}
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
                              pluginUses={activeTurnId ? (pluginUsesByTurnId.get(activeTurnId) ?? []) : []}
                              segments={[item.message]}
                            />
                          ) : null}
                        </Fragment>
                      ))}
                      {showActiveTurnPlaceholder && !activeUserVisible ? (
                        <ActiveWorkPlaceholder
                          pluginUses={activeTurnId ? (pluginUsesByTurnId.get(activeTurnId) ?? []) : []}
                          segments={[]}
                        />
                      ) : null}
                      {contextCompactionRunning ? <ContextCompactionStatus active /> : null}
                      <div className="chat-bubble-list__bottom-spacer" aria-hidden="true" />
                    </div>
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
          {actionError ? <div className="chat-action-error">{actionError}</div> : null}
          {showEmptyStarter ? null : deleteMode ? (
            <DeleteSelectionBar
              allChecked={allDeleteSelected}
              disabled={!selectedDeleteMessageIds.length || deletingMessages}
              indeterminate={someDeleteSelected}
              loading={deletingMessages}
              selectedCount={selectedDeleteCount}
              totalCount={selectableDeleteItems.length}
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

function ChatStarter({ composer, title, onSelectSuggestion }: { composer: ReactNode; title: string; onSelectSuggestion: (prompt: string) => void }) {
  const { t } = useI18n();

  return (
    <div className="chat-starter">
      <div className="chat-starter__intro">
        <div className="chat-starter__heading">
          <img className="chat-starter__system-icon" src={setsunaAppIconUrl} alt="" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
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
