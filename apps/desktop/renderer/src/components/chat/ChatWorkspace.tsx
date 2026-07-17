import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Bubble } from '@ant-design/x';
import { ArrowDown, BookOpen, Bug, Copy, Hammer, Pencil, SearchCode, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react';
import type { AnswerRuntimeApprovalInput, DesktopRuntimeClient, RuntimeCollaborationMode, RuntimeConfigState, RuntimeMessage, RuntimePlanDecision, RuntimePluginSummary, RuntimeSkillSummary, RuntimeThread, RuntimeThreadMemoryMode, RuntimeThreadSummary, RuntimeUsageResponse, WorkspaceEntrySearchResponse, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ChatComposer } from './ChatComposer.js';
import { ChatMessageAttachments } from './ChatMessageAttachments.js';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';
import { ConversationOverviewPanel } from './ConversationOverviewPanel.js';
import { ContextCompactionStatus } from './ContextCompactionStatus.js';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';
import { MarkdownRenderer } from './markdown/MarkdownRenderer.js';
import { MarkdownViewportProvider } from './markdown/MarkdownViewportProvider.js';
import { FileChangesSummaryCard, RuntimeHookRuns, RuntimeToolRuns, isDisplayableRuntimeToolRun, type ToolRunSummaryMode } from './RuntimeToolRuns.js';
import { RuntimeArtifactList } from './RuntimeArtifactList.js';
import { RuntimePluginUses } from './RuntimePluginUses.js';
import { StreamingScrollPinProvider } from './StreamingScrollPinProvider.js';
import { createAssistantGuidanceTimelinePlan, type AssistantGuidanceTimelinePlan, type AssistantWorkHistoryPlanEntry } from './chatAssistantGuidanceTimeline.js';
import { createAssistantRunTimeline, type AssistantRunTimelineBlock } from './chatAssistantTimeline.js';
import { conversationOverviewFromMessages } from './chatConversationOverview.js';
import { activeModelContextWindowTokens, contextTokenUsageFromThread, type ChatContextTokenUsage } from './chatContextUsage.js';
import { canFitConversationOverviewPanel, doesConversationOverviewOverlapContent, needsConversationOverviewContentShift, shouldAutoHideConversationOverview, shouldCompactConversationOverview, shouldShiftConversationOverviewContent } from './conversationOverviewLayout.js';
import { activeAssistantRunItemId, assistantRunCopyText, assistantRunIsActive, assistantRunStatus, chatDisplayItemRenderKey, createChatDisplayItems, createChatRenderWindow, createChatScrollSignal, type ChatDisplayItem } from './chatMessageDisplay.js';
import { hasThinkingSegments } from './chatThinkingContent.js';
import { workHistoryDisplayState } from './chatWorkHistoryState.js';
import { memoryCitationEntriesFromMessages } from './chatMemoryCitations.js';
import { chatThreadUsageForDisplay } from './chatThreadUsage.js';
import { collapseFileMutationRunsInSegments, fileChangeSummaryFromRuns } from './runtimeFileChanges.js';
import { runtimeArtifactsFromToolRuns } from './runtimeArtifacts.js';
import { runtimePluginUsesByTurn, type RuntimePluginUse } from './runtimePluginUsage.js';
import { useStreamingScrollPin } from './useStreamingScrollPin.js';
import type { ChatImageAttachmentOutcome, ChatImageAttachmentRequest, ChatSkillSelectionRequest, ChatWorkspaceMentionRequest, ConversationOverviewVisibility } from '../../types/app.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { ActionTooltip } from '../primitives.js';
import type { DesktopReviewLoadOptions, DesktopReviewState } from '../workspace/model.js';
import setsunaAppIconUrl from '../../../../../../assets/build/icon.png';

// 滚动吸附阈值：用户滚动距离底部超过此值时视为"未贴底"
const scrollBottomThresholdPx = 96;
// 滚动距离底部小于此值时视为"已贴底"
const stickyBottomThresholdPx = 4;
// 流式内容自动贴底需要连续多帧 settle，避免滚动少一截
const pinnedScrollSettleFrameCount = 3;
// 键盘滚动意图快捷键
const keyboardScrollIntentKeys = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);
type AnswerApprovalHandler = (approvalId: string, input: AnswerRuntimeApprovalInput) => void | Promise<void>;
type WorkHistoryExpandedChangeHandler = (itemId: string, expanded: boolean) => void;
type StarterSuggestion = {
  accent: 'blue' | 'green' | 'orange' | 'purple';
  icon: LucideIcon;
  label: string;
  prompt: string;
};

const starterSuggestions: StarterSuggestion[] = [
  {
    accent: 'blue',
    icon: SearchCode,
    label: '探索并理解代码',
    prompt: '请帮我探索并理解当前项目的代码结构、核心模块和主要运行流程。',
  },
  {
    accent: 'purple',
    icon: Hammer,
    label: '构建新功能、应用或工具',
    prompt: '请帮我在当前项目中构建一个新功能：',
  },
  {
    accent: 'green',
    icon: ShieldCheck,
    label: '审查代码并提出修改建议',
    prompt: '请审查当前项目的代码，并提出具体、可执行的修改建议。',
  },
  {
    accent: 'orange',
    icon: Bug,
    label: '修复问题和失败',
    prompt: '请帮我定位并修复当前项目中的这个问题：',
  },
];

export function ChatWorkspace({
  activeTurnId,
  activeProject,
  canClearContext,
  client,
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
  onApprovalPolicyChange,
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
  reviewLoading = false,
  reviewState = null,
  plugins = [],
  variant = 'main',
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  canClearContext: boolean;
  client: DesktopRuntimeClient;
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
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
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
  reviewLoading?: boolean;
  reviewState?: DesktopReviewState | null;
  plugins?: RuntimePluginSummary[];
  variant?: 'main' | 'side';
}) {
  const messages = currentThread?.messages ?? [];
  const displayItems = useMemo(() => createChatDisplayItems(messages), [messages]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const requestedReviewProjectRef = useRef<string | null>(null);
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
  const overviewContextLabel = useMemo(() => conversationOverviewContextLabel(contextUsage, currentThread?.contextCompaction?.status), [contextUsage, currentThread?.contextCompaction?.status]);
  const showEmptyStarter = variant === 'main' && displayItems.length === 0 && !activeTurnId;
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const conversationClassName = ['chat-main-conversation', showEmptyStarter || deleteMode ? '' : 'chat-main-conversation--with-bottom-sender', conversationOverview && overviewShiftsContent ? 'chat-main-conversation--overview-shifted' : ''].filter(Boolean).join(' ');
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [selectedDeleteItemIds, setSelectedDeleteItemIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
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
  useEffect(() => {
    const workspaceRoot = activeProject?.path ?? null;
    if (requestedReviewProjectRef.current !== workspaceRoot) requestedReviewProjectRef.current = null;
    if (!workspaceRoot || !conversationOverview || reviewState || reviewLoading || requestedReviewProjectRef.current === workspaceRoot) return;
    requestedReviewProjectRef.current = workspaceRoot;
    void onReviewRefresh?.();
  }, [activeProject?.path, conversationOverview, onReviewRefresh, reviewLoading, reviewState]);
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
    if (!selectedDeleteMessageIds.length) {
      setActionError('请选择要删除的消息');
      return;
    }
    setDeletingMessages(true);
    setActionError(null);
    try {
      // 删除时传 messageIds 而不是 display item ids，因为一个 assistant item 可能包含多段消息和工具消息。
      await onDeleteMessages(selectedDeleteMessageIds);
      cancelDeleteSelection();
    } catch (unknownError) {
      setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setDeletingMessages(false);
    }
  }, [cancelDeleteSelection, onDeleteMessages, selectedDeleteMessageIds]);

  const composer = (starter = false) => (
    <ChatComposer
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
      skillSelectionRequest={skillSelectionRequest}
      workspaceMentionRequest={workspaceMentionRequest}
      skills={skills}
      threadUsage={displayedThreadUsage}
      starter={starter}
      threadMemoryMode={currentThread?.memoryMode}
      placeholder={variant === 'side' ? '给侧边任务发送消息' : undefined}
      onCancelActiveTurn={onCancelActiveTurn}
      onApprovalPolicyChange={onApprovalPolicyChange}
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
  const starterTitle = activeProject ? `我们应该在 ${activeProject.name} 中构建什么？` : '我们该做什么？';
  const startEditingMessage = useCallback((message: RuntimeMessage) => {
    setActionError(null);
    setDeleteMode(false);
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
      setEditingSubmitting(true);
      setActionError(null);
      try {
        await onEditUserMessage(messageId, content);
        cancelEditingMessage();
      } catch (unknownError) {
        setActionError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      } finally {
        setEditingSubmitting(false);
      }
    },
    [cancelEditingMessage, editingDraft, onEditUserMessage],
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
              <button className="chat-scroll-bottom" type="button" aria-label="滚动到底部" onClick={() => scrollToBottom()}>
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
  return (
    <div className="chat-starter">
      <div className="chat-starter__intro">
        <div className="chat-starter__heading">
          <img className="chat-starter__system-icon" src={setsunaAppIconUrl} alt="" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        <div className="chat-starter__suggestions" role="group" aria-label="快捷建议">
          {starterSuggestions.map((suggestion) => {
            const Icon = suggestion.icon;
            return (
              <button key={suggestion.label} className={`chat-starter-suggestion chat-starter-suggestion--${suggestion.accent}`} type="button" onClick={() => onSelectSuggestion(suggestion.prompt)}>
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{suggestion.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {composer}
    </div>
  );
}

function ChatScrollOverlay({ disabled, scrollRef, scrollSignal }: { disabled: boolean; scrollRef: RefObject<HTMLDivElement | null>; scrollSignal: string }) {
  const dragRef = useRef<{
    scrollRange: number;
    startScrollTop: number;
    startY: number;
    thumbRange: number;
  } | null>(null);
  const [metrics, setMetrics] = useState({
    height: 0,
    thumbHeight: 0,
    thumbTop: 0,
    top: 0,
    visible: false,
  });
  const updateMetrics = useCallback(() => {
    const node = scrollRef.current;
    if (!node || disabled) {
      setMetrics((current) => (current.visible ? { height: 0, thumbHeight: 0, thumbTop: 0, top: 0, visible: false } : current));
      return;
    }
    const height = node.clientHeight;
    const scrollHeight = node.scrollHeight;
    const visible = scrollHeight > height + 1;
    const thumbHeight = visible ? Math.max(36, Math.round((height / scrollHeight) * height)) : 0;
    const thumbRange = Math.max(0, height - thumbHeight);
    const scrollRange = Math.max(0, scrollHeight - height);
    const thumbTop = scrollRange > 0 ? Math.round((node.scrollTop / scrollRange) * thumbRange) : 0;
    const next = {
      height,
      thumbHeight,
      thumbTop,
      top: node.offsetTop,
      visible,
    };
    setMetrics((current) => (current.height === next.height && current.thumbHeight === next.thumbHeight && current.thumbTop === next.thumbTop && current.top === next.top && current.visible === next.visible ? current : next));
  }, [disabled, scrollRef]);

  useLayoutEffect(() => {
    updateMetrics();
    const node = scrollRef.current;
    if (!node || disabled) return undefined;
    node.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      observer?.disconnect();
    };
  }, [disabled, scrollRef, scrollSignal, updateMetrics]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      if (!node || !metrics.visible) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        scrollRange: Math.max(0, node.scrollHeight - node.clientHeight),
        startScrollTop: node.scrollTop,
        startY: event.clientY,
        thumbRange: Math.max(1, metrics.height - metrics.thumbHeight),
      };
    },
    [metrics.height, metrics.thumbHeight, metrics.visible, scrollRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      const drag = dragRef.current;
      if (!node || !drag) return;
      const delta = event.clientY - drag.startY;
      node.scrollTop = drag.startScrollTop + (delta / drag.thumbRange) * drag.scrollRange;
    },
    [scrollRef],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!metrics.visible) return null;

  return (
    <div className="chat-scrollbar-overlay" aria-hidden="true" style={{ height: metrics.height, top: metrics.top }}>
      <div className="chat-scrollbar-overlay__thumb" style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }} onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
    </div>
  );
}

/**
 * 在用户没有主动离开底部时，让流式聊天持续吸附到底部。
 *
 * @param scrollSignal 影响滚动高度或活动状态的紧凑信号。
 * @param showEmptyStarter 当前是否处于空线程 starter 页面。
 * @param threadId 当前线程 ID，切换线程时用于重置滚动状态。
 */
function usePinnedChatScroll({ contentRef, scrollSignal, showEmptyStarter, threadId }: { contentRef: RefObject<HTMLDivElement | null>; scrollSignal: string; showEmptyStarter: boolean; threadId: string | null }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // sticky 状态放在 ref 里，滚动事件高频触发时不需要每次 rerender。
  const shouldStickToBottomRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  // token 递增会让已排队的 animation-frame 滚动失效，用于线程切换或用户手势打断。
  const scrollScheduleTokenRef = useRef(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const scrollDistanceToBottom = useCallback((node: HTMLDivElement) => Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight), []);
  const cancelScheduledScroll = useCallback(() => {
    // 先递增 token，再 cancel frame，覆盖已经进入回调队列但尚未执行的情况。
    scrollScheduleTokenRef.current += 1;
    if (scrollFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = null;
  }, []);
  const scrollToBottomNow = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setShowScrollBottom(false);
  }, []);
  const schedulePinnedScroll = useCallback(
    (frameCount = pinnedScrollSettleFrameCount) => {
      if (showEmptyStarter || !shouldStickToBottomRef.current) return;
      if (typeof window === 'undefined') {
        scrollToBottomNow();
        return;
      }

      // 流式 Markdown 和工具面板可能连续几帧增高，多帧 settle 可以避免滚动少一截。
      const token = scrollScheduleTokenRef.current + 1;
      scrollScheduleTokenRef.current = token;
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);

      const tick = (remainingFrames: number) => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (token !== scrollScheduleTokenRef.current) return;
          scrollFrameRef.current = null;
          if (!shouldStickToBottomRef.current) return;
          scrollToBottomNow();
          if (remainingFrames > 1) tick(remainingFrames - 1);
        });
      };

      tick(Math.max(1, frameCount));
    },
    [scrollToBottomNow, showEmptyStarter],
  );

  const syncScrollBottomState = useCallback(() => {
    const node = scrollRef.current;
    if (!node || showEmptyStarter) {
      setShowScrollBottom(false);
      return;
    }

    const distanceToBottom = scrollDistanceToBottom(node);
    const atBottom = distanceToBottom <= stickyBottomThresholdPx;
    if (atBottom) {
      // 回到底部后重新进入 sticky 模式，后续流式内容继续自动跟随。
      userScrollIntentRef.current = false;
      shouldStickToBottomRef.current = true;
      setShowScrollBottom(false);
      return;
    }

    const nearBottom = distanceToBottom <= scrollBottomThresholdPx;
    // Resize 和程序滚动也会触发 scroll；只有明确用户手势才允许解除 sticky。
    if (userScrollIntentRef.current) {
      shouldStickToBottomRef.current = false;
      setShowScrollBottom(!nearBottom);
      return;
    }

    if (shouldStickToBottomRef.current) {
      setShowScrollBottom(false);
      schedulePinnedScroll(1);
      return;
    }

    setShowScrollBottom(true);
  }, [schedulePinnedScroll, scrollDistanceToBottom, showEmptyStarter]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const node = scrollRef.current;
      if (!node) return;
      userScrollIntentRef.current = false;
      shouldStickToBottomRef.current = true;
      setShowScrollBottom(false);
      node.scrollTo({ top: node.scrollHeight, behavior });
      if (behavior === 'auto') schedulePinnedScroll(2);
    },
    [schedulePinnedScroll],
  );

  const markUserScrollIntent = useCallback(() => {
    if (!showEmptyStarter) userScrollIntentRef.current = true;
  }, [showEmptyStarter]);

  const releasePinnedScrollForUser = useCallback(() => {
    if (showEmptyStarter) return;
    cancelScheduledScroll();
    // 用户主动滚动后保持当前位置，直到用户点击“滚动到底部”或真的回到底部。
    userScrollIntentRef.current = true;
    shouldStickToBottomRef.current = false;
    const node = scrollRef.current;
    if (!node) return;
    setShowScrollBottom(scrollDistanceToBottom(node) > scrollBottomThresholdPx);
  }, [cancelScheduledScroll, scrollDistanceToBottom, showEmptyStarter]);

  const handleScrollWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (showEmptyStarter) return;
      const node = scrollRef.current;
      if (!node) return;
      const distanceToBottom = scrollDistanceToBottom(node);
      if (event.deltaY < 0 || distanceToBottom > stickyBottomThresholdPx) {
        releasePinnedScrollForUser();
        return;
      }
      markUserScrollIntent();
    },
    [markUserScrollIntent, releasePinnedScrollForUser, scrollDistanceToBottom, showEmptyStarter],
  );

  const handleScrollTouchMove = useCallback(
    (_event: ReactTouchEvent<HTMLDivElement>) => {
      releasePinnedScrollForUser();
    },
    [releasePinnedScrollForUser],
  );

  const handleScrollKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardScrollIntentKeys.has(event.key)) return;
      if (event.key === 'End') {
        markUserScrollIntent();
        return;
      }
      releasePinnedScrollForUser();
    },
    [markUserScrollIntent, releasePinnedScrollForUser],
  );

  const markScrollbarDragIntent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      if (!node || node.scrollHeight <= node.clientHeight || showEmptyStarter) return;
      const scrollbarHitWidth = Math.max(12, node.offsetWidth - node.clientWidth);
      const { right } = node.getBoundingClientRect();
      // 只在点击滚动条轨道区域时认为是拖拽意图，普通内容点击不解除 sticky。
      if (event.clientX >= right - scrollbarHitWidth) {
        releasePinnedScrollForUser();
      }
    },
    [releasePinnedScrollForUser, showEmptyStarter],
  );

  useLayoutEffect(() => {
    cancelScheduledScroll();
    userScrollIntentRef.current = false;
    const node = scrollRef.current;
    if (!node) return;
    if (showEmptyStarter) {
      // starter 页面没有 transcript，滚动位置固定在顶部，避免 composer 被强行贴底。
      node.scrollTop = 0;
      shouldStickToBottomRef.current = false;
      setShowScrollBottom(false);
      return;
    }
    shouldStickToBottomRef.current = true;
    schedulePinnedScroll();
  }, [cancelScheduledScroll, schedulePinnedScroll, showEmptyStarter, threadId]);

  useLayoutEffect(() => {
    if (showEmptyStarter) return;
    if (shouldStickToBottomRef.current) {
      schedulePinnedScroll();
    } else {
      syncScrollBottomState();
    }
  }, [schedulePinnedScroll, scrollSignal, showEmptyStarter, syncScrollBottomState]);

  useLayoutEffect(() => {
    const contentNode = contentRef.current;
    const listNode = listRef.current;
    const scrollNode = scrollRef.current;
    if (!scrollNode || showEmptyStarter || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      // 监听内容和容器尺寸变化，覆盖图片/代码块/工具面板异步撑高的情况。
      if (shouldStickToBottomRef.current) {
        schedulePinnedScroll();
      } else {
        syncScrollBottomState();
      }
    });
    if (contentNode) observer.observe(contentNode);
    if (listNode && listNode !== contentNode) observer.observe(listNode);
    observer.observe(scrollNode);
    return () => observer.disconnect();
  }, [schedulePinnedScroll, scrollSignal, showEmptyStarter, syncScrollBottomState]);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    contentRef,
    handleScroll: syncScrollBottomState,
    handleScrollKeyDown,
    handleScrollTouchMove,
    handleScrollWheel,
    listRef,
    markScrollbarDragIntent,
    scrollRef,
    scrollToBottom,
    showScrollBottom,
  };
}

function useConversationOverviewAutoExpand(conversationRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>): { canExpand: boolean; needsContentShift: boolean } {
  const [layout, setLayout] = useState(() => ({ canExpand: false, needsContentShift: false }));

  useLayoutEffect(() => {
    const conversationNode = conversationRef.current;
    const contentNode = contentRef.current;
    if (!conversationNode || !contentNode || typeof window === 'undefined') return undefined;

    const sync = () => {
      const conversationWidth = conversationNode.getBoundingClientRect().width;
      const contentWidth = contentNode.getBoundingClientRect().width;
      const nextLayout = {
        canExpand: canFitConversationOverviewPanel({ conversationWidth, contentWidth }),
        needsContentShift: needsConversationOverviewContentShift({ conversationWidth, contentWidth }),
      };
      setLayout((current) => (current.canExpand === nextLayout.canExpand && current.needsContentShift === nextLayout.needsContentShift ? current : nextLayout));
    };
    sync();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }

    const observer = new ResizeObserver(sync);
    observer.observe(conversationNode);
    observer.observe(contentNode);
    return () => observer.disconnect();
  }, [conversationRef, contentRef]);

  return layout;
}

function useConversationOverviewContentCollision(
  conversationRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  overviewRef: RefObject<HTMLElement | null>,
  active: boolean,
): boolean {
  const [overlapsContent, setOverlapsContent] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      setOverlapsContent(false);
      return undefined;
    }

    const conversationNode = conversationRef.current;
    const contentNode = contentRef.current;
    const overviewNode = overviewRef.current;
    if (!conversationNode || !contentNode || !overviewNode || typeof window === 'undefined') {
      setOverlapsContent(false);
      return undefined;
    }

    const sync = () => {
      const nextValue = doesConversationOverviewOverlapContent({
        conversationWidth: conversationNode.getBoundingClientRect().width,
        contentWidth: contentNode.getBoundingClientRect().width,
        overviewWidth: overviewNode.getBoundingClientRect().width,
      });
      setOverlapsContent((current) => (current === nextValue ? current : nextValue));
    };
    sync();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }

    const observer = new ResizeObserver(sync);
    observer.observe(conversationNode);
    observer.observe(contentNode);
    observer.observe(overviewNode);
    return () => observer.disconnect();
  }, [active, contentRef, conversationRef, overviewRef]);

  return overlapsContent;
}

function conversationOverviewContextLabel(usage: ChatContextTokenUsage, compactionStatus?: NonNullable<RuntimeThread['contextCompaction']>['status']): string {
  if (compactionStatus === 'running') return '压缩中';
  const percent = usage.visiblePercent || usage.percent;
  if (percent > 0) return `${formatPercent(percent)}%`;
  return '就绪';
}

function formatPercent(value: number): string {
  const safeValue = Math.min(100, Math.max(0, value));
  return safeValue > 0 && safeValue < 1 ? safeValue.toFixed(1) : safeValue.toFixed(0);
}

function MessageItem({
  activeAssistantItemId,
  activeTurnId,
  assistantItemIdByTurnId,
  deleteMode,
  editingDraft,
  editingMessageId,
  editingSubmitting,
  expandedWorkHistoryItemIds,
  item,
  onAnswerApproval,
  onCancelEdit,
  onDiscardFileChanges,
  onEditDraftChange,
  onOpenFileReview,
  onPlanDecision,
  onStartEdit,
  onStartDelete,
  onSubmitEdit,
  onToggleDelete,
  onWorkHistoryExpandedChange,
  pluginUses,
  selectedForDelete,
}: {
  activeAssistantItemId: string | null;
  activeTurnId: string | null;
  assistantItemIdByTurnId: Map<string, string>;
  deleteMode: boolean;
  editingDraft: string;
  editingMessageId: string | null;
  editingSubmitting: boolean;
  expandedWorkHistoryItemIds: Set<string>;
  item: ChatDisplayItem;
  onAnswerApproval: AnswerApprovalHandler;
  onCancelEdit: () => void;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onEditDraftChange: (value: string) => void;
  onOpenFileReview?: (filePath?: string) => void;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onStartEdit: (message: RuntimeMessage) => void;
  onStartDelete: (itemId: string) => void;
  onSubmitEdit: (messageId: string) => void;
  onToggleDelete: (itemId: string, checked: boolean) => void;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  pluginUses: RuntimePluginUse[];
  selectedForDelete: boolean;
}) {
  if (item.type === 'assistant') {
    return (
      <AssistantRunItem
        activeTurnId={activeTurnId}
        activeAssistantItemId={activeAssistantItemId}
        deleteMode={deleteMode}
        item={item}
        onAnswerApproval={onAnswerApproval}
        onDiscardFileChanges={onDiscardFileChanges}
        onOpenFileReview={onOpenFileReview}
        onPlanDecision={onPlanDecision}
        onStartDelete={onStartDelete}
        onToggleDelete={onToggleDelete}
        onWorkHistoryExpandedChange={onWorkHistoryExpandedChange}
        pluginUses={pluginUses}
        selectedForDelete={selectedForDelete}
      />
    );
  }
  if (item.type === 'context') {
    return <ContextCompactionStatus message={item.message} />;
  }
  if (item.type === 'review') {
    return <ReviewModeMarker message={item.message} />;
  }
  const { message } = item;
  const streaming = message.status === 'streaming';
  const editing = editingMessageId === message.id;
  const steered = item.steered;
  const assistantItemId = message.turnId ? assistantItemIdByTurnId.get(message.turnId) : undefined;
  const workHistoryExpanded = assistantItemId ? expandedWorkHistoryItemIds.has(assistantItemId) : false;
  const showExtractedGuidance = Boolean(!steered && message.turnId && message.turnId !== activeTurnId && item.guidanceProcessed && item.steerMessages.length && !workHistoryExpanded);
  if (editing) {
    return <UserMessageEditor disabled={Boolean(activeTurnId) || editingSubmitting} message={message} submitting={editingSubmitting} value={editingDraft} onCancel={onCancelEdit} onChange={onEditDraftChange} onSubmit={() => onSubmitEdit(message.id)} />;
  }
  const hasAttachments = Boolean(message.attachments?.length);
  return (
    <article className={['chat-bubble-item', 'chat-bubble-item--user', deleteMode ? 'chat-bubble-item--selecting' : '', selectedForDelete ? 'is-selected-for-delete' : ''].filter(Boolean).join(' ')}>
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label="选择这条消息" onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
      <div className="chat-user-turn">
        <Bubble
          className={`chat-user-bubble ${hasAttachments ? 'chat-user-bubble--with-attachments' : ''}`}
          content={<UserMessageContent message={message} streaming={streaming} />}
          footer={<MessageFooter actionsDisabled={Boolean(activeTurnId) || deleteMode} align="end" message={message} onDelete={steered ? undefined : () => onStartDelete(item.id)} onEdit={steered ? undefined : () => onStartEdit(message)} timePosition={steered ? 'none' : 'before-actions'} />}
          placement="end"
          variant="filled"
        />
        <RuntimeHookRuns runs={message.hookRuns} />
        {showExtractedGuidance ? <GuidanceMessageList handledMessageIds={new Set(item.handledSteerMessageIds)} messages={item.steerMessages} /> : null}
      </div>
    </article>
  );
}

function UserMessageContent({ message, streaming }: { message: RuntimeMessage; streaming: boolean }) {
  return (
    <div className="chat-user-message-content">
      {message.attachments?.length ? (
        <ChatMessageAttachments attachments={message.attachments} />
      ) : null}
      {message.content || streaming ? (
        <div className="chat-user-message-content__text">
          <WorkspaceMentionText content={message.content || '...'} />
        </div>
      ) : null}
    </div>
  );
}

function AssistantRunItem({
  activeAssistantItemId,
  activeTurnId,
  deleteMode,
  item,
  onAnswerApproval,
  onDiscardFileChanges,
  onOpenFileReview,
  onPlanDecision,
  onStartDelete,
  onToggleDelete,
  onWorkHistoryExpandedChange,
  pluginUses,
  selectedForDelete,
}: {
  activeAssistantItemId: string | null;
  activeTurnId: string | null;
  deleteMode: boolean;
  item: Extract<ChatDisplayItem, { type: 'assistant' }>;
  onAnswerApproval: AnswerApprovalHandler;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: (filePath?: string) => void;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onStartDelete: (itemId: string) => void;
  onToggleDelete: (itemId: string, checked: boolean) => void;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  pluginUses: RuntimePluginUse[];
  selectedForDelete: boolean;
}) {
  const status = assistantRunStatus(item);
  const belongsToActiveTurn = assistantRunIsActive(item, activeTurnId);
  const active = belongsToActiveTurn && item.id === activeAssistantItemId;
  const streaming = status === 'streaming' || active;
  const lastSegment = item.segments[item.segments.length - 1];
  const footerMessage = {
    ...(lastSegment ?? item.segments[0]),
    content: assistantRunCopyText(item),
  } as RuntimeMessage;
  return (
    <article className={['chat-bubble-item', 'chat-bubble-item--assistant', streaming ? 'chat-bubble-item--active' : '', deleteMode ? 'chat-bubble-item--selecting' : '', selectedForDelete ? 'is-selected-for-delete' : ''].filter(Boolean).join(' ')}>
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label="选择这条回复" onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
      <Bubble
        className="chat-ai-bubble"
        content={<AssistantRunContent active={active} item={item} onAnswerApproval={onAnswerApproval} onDiscardFileChanges={onDiscardFileChanges} onOpenFileReview={onOpenFileReview} onPlanDecision={onPlanDecision} onWorkHistoryExpandedChange={onWorkHistoryExpandedChange} pluginUses={pluginUses} />}
        footer={belongsToActiveTurn ? undefined : <MessageFooter actionsDisabled={Boolean(activeTurnId) || deleteMode} message={footerMessage} onDelete={() => onStartDelete(item.id)} timePosition="after-actions" />}
        placement="start"
        streaming={streaming}
        variant="borderless"
      />
    </article>
  );
}

function UserMessageEditor({ disabled, message, onCancel, onChange, onSubmit, submitting, value }: { disabled: boolean; message: RuntimeMessage; onCancel: () => void; onChange: (value: string) => void; onSubmit: () => void; submitting: boolean; value: string }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!value.trim() || disabled) return;
    onSubmit();
  };
  return (
    <article className="chat-bubble-item chat-bubble-item--user">
      <form className="chat-user-edit" onSubmit={submit}>
        <textarea autoFocus disabled={disabled} value={value} rows={Math.min(8, Math.max(2, value.split('\n').length))} onChange={(event) => onChange(event.currentTarget.value)} />
        <div className="chat-user-edit__footer">
          <time>{formatTime(message.createdAt)}</time>
          <span className="chat-user-edit__actions">
            <button type="button" disabled={disabled} onClick={onCancel}>
              取消
            </button>
            <button type="submit" disabled={disabled || !value.trim()}>
              {submitting ? '发送中' : '发送'}
            </button>
          </span>
        </div>
      </form>
    </article>
  );
}

function MessageSelectionControl({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="chat-message-select" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}

function ReviewModeMarker({ message }: { message: RuntimeMessage }) {
  const notice = message.reviewMode;
  if (!notice) return null;
  const label = notice.kind === 'entered' ? `开始代码审查：${notice.review}` : '代码审查完成';
  return (
    <div className="chat-review-mode-marker" aria-label={label}>
      <span className="chat-review-mode-marker__line" />
      <span className="chat-review-mode-marker__text">{label}</span>
    </div>
  );
}

function TranscriptWindowDivider({ hiddenMessageCount, onShowAll }: { hiddenMessageCount: number; onShowAll: () => void }) {
  const count = Math.max(0, hiddenMessageCount);
  return <ChatTimelineDivider accessibilityLabel="较早记录已折叠" label={count > 0 ? `已折叠较早的 ${count} 条消息` : '已折叠较早的消息'} onClick={onShowAll} />;
}

function DeleteSelectionBar({
  allChecked,
  disabled,
  indeterminate,
  loading,
  onCancel,
  onConfirm,
  onToggleAll,
  selectedCount,
  totalCount,
}: {
  allChecked: boolean;
  disabled: boolean;
  indeterminate: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleAll: (checked: boolean) => void;
  selectedCount: number;
  totalCount: number;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className="chat-delete-bar">
      <div className="chat-delete-bar__inner">
        <label className="chat-delete-bar__select-all">
          <input ref={checkboxRef} type="checkbox" checked={allChecked} disabled={loading || totalCount === 0} onChange={(event) => onToggleAll(event.currentTarget.checked)} />
          <span>全选</span>
        </label>
        <span className="chat-delete-bar__count">已选 {selectedCount}</span>
        <button type="button" className="chat-delete-bar__cancel" disabled={loading} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="chat-delete-bar__confirm" disabled={disabled} onClick={onConfirm}>
          {loading ? '删除中' : '删除'}
        </button>
      </div>
    </div>
  );
}

function AssistantRunContent({
  active,
  item,
  onAnswerApproval,
  onDiscardFileChanges,
  onOpenFileReview,
  onPlanDecision,
  onWorkHistoryExpandedChange,
  pluginUses,
}: {
  active: boolean;
  item: Extract<ChatDisplayItem, { type: 'assistant' }>;
  onAnswerApproval: AnswerApprovalHandler;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: (filePath?: string) => void;
  onPlanDecision: (decision: RuntimePlanDecision) => void;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  pluginUses: RuntimePluginUse[];
}) {
  const displaySegments = useMemo(() => collapseFileMutationRunsInSegments(item.segments), [item.segments]);
  const planSegment = useMemo(() => [...displaySegments].reverse().find((segment) => segment.planMode), [displaySegments]);
  const status = assistantRunStatus(item);
  const hasStreamingSegment = displaySegments.some((segment) => segment.status === 'streaming');
  const timelineBlocks = useMemo(
    () => createAssistantRunTimeline(displaySegments, pluginUses),
    [displaySegments, pluginUses],
  );
  const toolAttachments = item.toolAttachments ?? [];
  const toolRuns = useMemo(() => displaySegments.flatMap((segment) => segment.toolRuns ?? []), [displaySegments]);
  const hasRenderableContent = timelineBlocks.length > 0 || toolAttachments.length > 0;
  const hasWorkBlock = timelineBlocks.some((block) => block.type === 'work');
  const hasFinalAnswerContent = timelineBlocks.some((block) => block.type === 'content' && block.content.trim());
  const workHistoryState = workHistoryDisplayState({ hasFinalAnswerContent, runActive: active });
  const showActiveWorkPlaceholder = active && status !== 'error' && !hasWorkBlock;
  const awaitingApproval = toolRuns.some((run) => run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected' && run.approvalStatus !== 'cancelled');
  // 活动回合已有内容时，等待反馈始终跟在最新内容之后；等待用户审批时则不显示假进度。
  const showTrailingLoading = active && status !== 'error' && hasRenderableContent && !awaitingApproval;
  const guidanceMessageIds = useMemo(() => new Set(item.handledSteerMessageIds), [item.handledSteerMessageIds]);
  const assistantGuidanceMessages = item.steerMessages;
  const timelinePlan = useMemo(
    () =>
      createAssistantGuidanceTimelinePlan({
        active,
        blocks: timelineBlocks,
        guidanceMessages: assistantGuidanceMessages,
        messageOrderIds: item.messageIds,
        workHistoryActive: workHistoryState.active,
      }),
    [active, assistantGuidanceMessages, item.messageIds, timelineBlocks, workHistoryState.active],
  );
  const activeGuidanceBeforeFirstBlock = timelinePlan.placeholderGuidance;
  const activePlaceholderGuidance = activeGuidanceBeforeFirstBlock.length ? <GuidanceMessageList handledMessageIds={guidanceMessageIds} markerMode="handled" messages={activeGuidanceBeforeFirstBlock} /> : null;
  const fileChangeSummary = useMemo(() => {
    if (active || !hasFinalAnswerContent) return null;
    return fileChangeSummaryFromRuns(toolRuns);
  }, [active, hasFinalAnswerContent, toolRuns]);
  const memoryCitations = useMemo(() => memoryCitationEntriesFromMessages(displaySegments), [displaySegments]);
  const artifacts = useMemo(() => runtimeArtifactsFromToolRuns(toolRuns), [toolRuns]);
  if (!hasRenderableContent && (hasStreamingSegment || active)) {
    return active ? (
      <div className="chat-assistant-run">
        <ActiveWorkPlaceholder segments={displaySegments}>{activePlaceholderGuidance}</ActiveWorkPlaceholder>
      </div>
    ) : (
      <AssistantLoadingIndicator label="思考中" />
    );
  }
  if (planSegment) {
    return (
      <div className="chat-assistant-run">
        <RuntimePluginUses active={active} plugins={pluginUses} />
        <PlanCard message={planSegment} active={active} onPlanDecision={onPlanDecision} />
      </div>
    );
  }
  return (
    <div className="chat-assistant-run">
      {showActiveWorkPlaceholder ? (
        <ActiveWorkPlaceholder segments={displaySegments} showLoading={!showTrailingLoading}>
          {activePlaceholderGuidance}
        </ActiveWorkPlaceholder>
      ) : null}
      {renderAssistantTimelinePlan({
        active,
        handledGuidanceMessageIds: guidanceMessageIds,
        itemId: chatDisplayItemRenderKey(item),
        onAnswerApproval,
        onWorkHistoryExpandedChange,
        plan: timelinePlan,
        workHistoryDefaultExpanded: workHistoryState.expanded,
      })}
      {toolAttachments.length ? (
        <div className="chat-assistant-run__segment chat-assistant-run__attachments">
          <ChatMessageAttachments attachments={toolAttachments} variant="assistant" />
        </div>
      ) : null}
      {showTrailingLoading ? <AssistantLoadingIndicator label="正在处理" showLabel={false} /> : null}
      {fileChangeSummary ? (
        <div className="chat-assistant-run__segment">
          <FileChangesSummaryCard summary={fileChangeSummary} onDiscardChanges={onDiscardFileChanges} onOpenReview={onOpenFileReview} />
        </div>
      ) : null}
      {!active && artifacts.length ? (
        <div className="chat-assistant-run__segment">
          <RuntimeArtifactList artifacts={artifacts} />
        </div>
      ) : null}
      {!active && memoryCitations.length ? <MemoryCitationCard entries={memoryCitations} /> : null}
    </div>
  );
}

function MemoryCitationCard({ entries }: { entries: NonNullable<RuntimeMessage['memoryCitation']>['entries'] }) {
  return (
    <details className="chat-memory-citations">
      <summary>
        <BookOpen size={13} />
        <span>本回答使用了 {entries.length} 条记忆</span>
      </summary>
      <div className="chat-memory-citations__list">
        {entries.map((entry) => (
          <div key={`${entry.path}:${entry.lineStart}:${entry.lineEnd}`}>
            <code>
              {entry.path}:{entry.lineStart}
              {entry.lineEnd !== entry.lineStart ? `-${entry.lineEnd}` : ''}
            </code>
            <span>{entry.note}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function PlanCard({ message, active, onPlanDecision }: { message: RuntimeMessage; active: boolean; onPlanDecision: (decision: RuntimePlanDecision) => void }) {
  const planMode = message.planMode;
  if (!planMode) return null;
  const status = planMode.status;
  const streaming = message.status === 'streaming';
  const awaiting = status === 'awaiting_confirmation';
  const canDecide = awaiting && !active;
  const statusLabel = awaiting ? '待确认' : status === 'accepted' ? '已接受' : '已放弃';
  const body = message.content.trim() ? <MarkdownRenderer content={message.content} streaming={streaming} /> : streaming ? <AssistantLoadingIndicator label="正在拟定计划" /> : null;
  return (
    <section className={`chat-plan-card chat-plan-card--${status}${streaming ? ' is-streaming' : ''}`}>
      <header className="chat-plan-card__header">
        <span className="chat-plan-card__title">计划</span>
        <span className={`chat-plan-card__status chat-plan-card__status--${status}`}>{statusLabel}</span>
      </header>
      <div className="chat-plan-card__body">{body}</div>
      {canDecide ? (
        <footer className="chat-plan-card__actions">
          <button type="button" className="chat-plan-card__action chat-plan-card__action--accept" onClick={() => onPlanDecision('accepted')}>
            接受并执行
          </button>
          <button type="button" className="chat-plan-card__action chat-plan-card__action--dismiss" onClick={() => onPlanDecision('dismissed')}>
            放弃
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function GuidanceMessageList({ handledMessageIds, markerMode = 'none', messages }: { handledMessageIds: Set<string>; markerMode?: 'none' | 'handled' | 'always'; messages: RuntimeMessage[] }) {
  if (!messages.length) return null;
  const showMarker = markerMode === 'always' || (markerMode === 'handled' && messages.some((message) => handledMessageIds.has(message.id)));
  return (
    <div className="chat-guidance-list">
      {messages.map((message) => (
        <GuidanceMessage key={message.id} message={message} />
      ))}
      {showMarker ? <GuidanceProcessedMarker /> : null}
    </div>
  );
}

function GuidanceMessage({ message }: { message: RuntimeMessage }) {
  return (
    <div className="chat-guidance-message">
      <div className="chat-guidance-message__bubble">
        <UserMessageContent message={message} streaming={false} />
      </div>
      <MessageFooter align="end" message={message} timePosition="none" />
    </div>
  );
}

function GuidanceProcessedMarker() {
  return (
    <div className="chat-guidance-marker" aria-label="已引导对话">
      已引导对话
    </div>
  );
}

function renderAssistantTimelinePlan({
  active,
  handledGuidanceMessageIds,
  itemId,
  onAnswerApproval,
  onWorkHistoryExpandedChange,
  plan,
  workHistoryDefaultExpanded,
}: {
  active: boolean;
  handledGuidanceMessageIds: Set<string>;
  itemId: string;
  onAnswerApproval: AnswerApprovalHandler;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  plan: AssistantGuidanceTimelinePlan;
  workHistoryDefaultExpanded: boolean;
}): ReactNode[] {
  const nodes: ReactNode[] = [];

  plan.nodes.forEach((node) => {
    if (node.type === 'workHistory') {
      nodes.push(
        assistantWorkHistoryNode({
          hasFollowingContent: plan.hasFollowingContent,
          handledGuidanceMessageIds,
          itemId,
          onAnswerApproval,
          onExpandedChange: onWorkHistoryExpandedChange,
          plan: node,
          workHistoryDefaultExpanded,
        }),
      );
      return;
    }

    nodes.push(assistantTimelineNode(node.block, active));
    if (active && node.guidanceAfter.length) {
      nodes.push(<GuidanceMessageList handledMessageIds={handledGuidanceMessageIds} key={`${node.block.id}:guidance`} markerMode="handled" messages={node.guidanceAfter} />);
    }
  });

  return nodes;
}

function assistantWorkHistoryNode({
  hasFollowingContent,
  handledGuidanceMessageIds,
  itemId,
  onAnswerApproval,
  onExpandedChange,
  plan,
  workHistoryDefaultExpanded,
}: {
  hasFollowingContent: boolean;
  handledGuidanceMessageIds: Set<string>;
  itemId: string;
  onAnswerApproval: AnswerApprovalHandler;
  onExpandedChange: WorkHistoryExpandedChangeHandler;
  plan: Extract<AssistantGuidanceTimelinePlan['nodes'][number], { type: 'workHistory' }>;
  workHistoryDefaultExpanded: boolean;
}): ReactNode {
  const workNodes = assistantWorkEntriesNodes(
    plan.entries,
    onAnswerApproval,
    hasFollowingContent,
    handledGuidanceMessageIds,
  );
  const workTiming = inferWorkTiming(plan.blocks.flatMap((block) => block.segments));
  const hasWorkDetails = workNodes.length > 0;
  if (!hasWorkDetails && !plan.active) return null;
  return (
    <WorkHistoryPanel active={plan.active} completedAtMs={workTiming.completedAtMs} defaultExpanded={workHistoryDefaultExpanded} hasDetails={hasWorkDetails} key="assistant-work-history" panelId={itemId} startedAtMs={workTiming.startedAtMs} onExpandedChange={onExpandedChange}>
      {workNodes}
    </WorkHistoryPanel>
  );
}

function assistantTimelineNode(block: Exclude<AssistantRunTimelineBlock, { type: 'work' }>, runActive: boolean): ReactNode {
  if (block.type === 'content') {
    return (
      <div className="chat-assistant-run__segment" key={block.id}>
        <MarkdownRenderer content={block.content} streaming={block.segment.status === 'streaming'} />
      </div>
    );
  }
  if (block.type === 'loading') {
    if (runActive) return null;
    return (
      <div className="chat-assistant-run__segment" key={block.id}>
        <AssistantLoadingIndicator label="正在处理" />
      </div>
    );
  }
  if (block.type === 'error') {
    return (
      <div className="chat-assistant-run__segment" key={block.id}>
        <div className="chat-message-error">{block.segment.error}</div>
      </div>
    );
  }
}

function assistantWorkEntriesNodes(
  entries: AssistantWorkHistoryPlanEntry[],
  onAnswerApproval: AnswerApprovalHandler,
  hasFollowingContent: boolean,
  handledGuidanceMessageIds: Set<string>,
): ReactNode[] {
  const toolRunSummaryMode: ToolRunSummaryMode = hasFollowingContent ? 'aggregate' : 'latest';
  const nodes: ReactNode[] = [];
  entries.forEach((entry) => {
    if (entry.type === 'guidance') {
      nodes.push(<GuidanceMessageList handledMessageIds={handledGuidanceMessageIds} key={entry.id} markerMode="handled" messages={entry.messages} />);
      return;
    }
    nodes.push(...assistantWorkItemNodes(entry.item, entry.active, toolRunSummaryMode, onAnswerApproval));
  });
  return nodes;
}

function assistantWorkItemNodes(
  item: Extract<AssistantRunTimelineBlock, { type: 'work' }>['items'][number],
  itemActive: boolean,
  toolRunSummaryMode: ToolRunSummaryMode,
  onAnswerApproval: AnswerApprovalHandler,
): ReactNode[] {
  if (item.type === 'content') {
    return [<MarkdownRenderer key={item.segment.id} content={item.segment.content} streaming={item.segment.segment.status === 'streaming'} />];
  }
  if (item.type === 'pluginUses') {
    return [<RuntimePluginUses active={itemActive} key={item.id} plugins={item.plugins} />];
  }
  if (item.type === 'thinking') {
    return itemActive && item.segment.content.trim()
      ? [
          <ActiveThinkingBox
            key={item.segment.id}
            content={item.segment.content}
            scrollStateKey={item.segment.id}
          />,
        ]
      : [];
  }
  const visibleToolRuns = item.toolRuns.filter(isDisplayableRuntimeToolRun);
  // 流式传输期间，连续工具片段会合并到此项目中，但首个片段保持稳定，
  // 从而保留非受控的 <details> DOM 节点。
  return visibleToolRuns.length ? [
    <RuntimeToolRuns
      key={item.segment.id}
      runs={visibleToolRuns}
      summaryMode={toolRunSummaryMode}
      onAnswerApproval={onAnswerApproval}
    />,
  ] : [];
}

function ActiveWorkPlaceholder({
  children,
  pluginUses = [],
  segments,
  showLoading = true,
}: {
  children?: ReactNode;
  pluginUses?: RuntimePluginUse[];
  segments: RuntimeMessage[];
  showLoading?: boolean;
}) {
  return (
    <WorkHistoryPanel active completedAtMs={null} hasDetails={Boolean(children) || pluginUses.length > 0 || showLoading} startedAtMs={inferActiveTurnStartedAtMs(segments)}>
      <RuntimePluginUses active plugins={pluginUses} />
      {children}
      {/* runtime 尚未产出内容时，在工作区内保留明确的进行中反馈。 */}
      {showLoading ? <AssistantLoadingIndicator label="正在处理" showLabel={false} /> : null}
    </WorkHistoryPanel>
  );
}

function inferWorkTiming(segments: RuntimeMessage[]): { startedAtMs: number | null; completedAtMs: number | null } {
  const startedAtMs: number[] = [];
  const completedAtMs: number[] = [];
  let hasWorkEvidence = false;

  for (const segment of segments) {
    const segmentStartedAtMs = parseDateMs(segment.createdAt);
    const segmentCompletedAtMs = parseDateMs(segment.completedAt);
    const hasThinking = hasThinkingSegments(segment.content);
    if (hasThinking) {
      hasWorkEvidence = true;
      if (segmentStartedAtMs !== null) startedAtMs.push(segmentStartedAtMs);
      if (segmentCompletedAtMs !== null) completedAtMs.push(segmentCompletedAtMs);
    }

    for (const run of segment.toolRuns ?? []) {
      hasWorkEvidence = true;
      const runStartedAtMs = parseDateMs(run.startedAt) ?? segmentStartedAtMs;
      const runCompletedAtMs = parseDateMs(run.completedAt);
      if (runStartedAtMs !== null) startedAtMs.push(runStartedAtMs);
      if (runCompletedAtMs !== null) completedAtMs.push(runCompletedAtMs);
    }
  }

  if (!startedAtMs.length && hasWorkEvidence) {
    for (const segment of segments) {
      const segmentStartedAtMs = parseDateMs(segment.createdAt);
      if (segmentStartedAtMs !== null) {
        startedAtMs.push(segmentStartedAtMs);
        break;
      }
    }
  }

  return {
    startedAtMs: startedAtMs.length ? Math.min(...startedAtMs) : null,
    completedAtMs: completedAtMs.length ? Math.max(...completedAtMs) : null,
  };
}

function inferActiveTurnStartedAtMs(segments: RuntimeMessage[]): number | null {
  const startedAtMs: number[] = [];
  for (const segment of segments) {
    const segmentStartedAtMs = parseDateMs(segment.createdAt);
    if (segmentStartedAtMs !== null) startedAtMs.push(segmentStartedAtMs);
    for (const run of segment.toolRuns ?? []) {
      const runStartedAtMs = parseDateMs(run.startedAt);
      if (runStartedAtMs !== null) startedAtMs.push(runStartedAtMs);
    }
  }
  return startedAtMs.length ? Math.min(...startedAtMs) : null;
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function ActiveThinkingBox({ content, scrollStateKey }: { content: string; scrollStateKey: string }): JSX.Element {
  const { handlePointerDown, handleScroll, handleTouchMove, handleWheel, scrollRef } = useStreamingScrollPin(content, scrollStateKey);

  return (
    <div className="chat-thinking-box" aria-live="polite" aria-label="正在思考">
      <div className="chat-thinking-box__content" ref={scrollRef} onPointerDownCapture={handlePointerDown} onScroll={handleScroll} onTouchMoveCapture={handleTouchMove} onWheelCapture={handleWheel}>
        <MarkdownRenderer content={content} streaming />
      </div>
      <div className="chat-thinking-box__status">正在思考</div>
    </div>
  );
}

function WorkHistoryPanel({
  active,
  children,
  completedAtMs,
  defaultExpanded = active,
  hasDetails,
  onExpandedChange,
  panelId,
  startedAtMs,
}: {
  active: boolean;
  children?: ReactNode;
  completedAtMs?: number | null;
  defaultExpanded?: boolean;
  hasDetails: boolean;
  onExpandedChange?: WorkHistoryExpandedChangeHandler;
  panelId?: string;
  startedAtMs?: number | null;
}) {
  const wasActiveRef = useRef(active);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [capturedCompletedAtMs, setCapturedCompletedAtMs] = useState<number | null>(() => completedAtMs ?? null);
  // 此属性只用于初始化一次面板；流式更新绝不会写入展开状态。
  const [manualExpanded, setManualExpanded] = useState(() => hasDetails && defaultExpanded);
  const canToggle = hasDetails;
  const expanded = hasDetails && manualExpanded;

  useEffect(() => {
    if (completedAtMs !== null && completedAtMs !== undefined) {
      setCapturedCompletedAtMs(completedAtMs);
      wasActiveRef.current = active;
      return;
    }
    if (active) {
      wasActiveRef.current = true;
      setCapturedCompletedAtMs(null);
      return;
    }
    if (wasActiveRef.current) {
      setCapturedCompletedAtMs((value) => value ?? Date.now());
    }
    wasActiveRef.current = active;
  }, [active, completedAtMs]);

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!panelId) return;
    onExpandedChange?.(panelId, expanded);
  }, [expanded, onExpandedChange, panelId]);

  const title = active ? '工作中' : '已处理';
  const durationEndMs = active ? nowMs : (capturedCompletedAtMs ?? completedAtMs ?? null);
  const durationLabel = formatDurationMs(startedAtMs !== null && startedAtMs !== undefined && durationEndMs !== null ? Math.max(0, durationEndMs - startedAtMs) : null);
  const summaryContent = (
    <>
      <span className="chat-work-history__title">{title}</span>
      {durationLabel ? <span className="chat-work-history__duration">{durationLabel}</span> : null}
    </>
  );
  const toggleExpanded = () => {
    if (!canToggle) return;
    setManualExpanded((value) => !value);
  };

  return (
    <div className={`chat-work-history ${expanded ? 'is-expanded' : ''} ${canToggle ? 'is-toggleable' : ''}`}>
      {canToggle ? (
        <button className="chat-work-history__summary" type="button" aria-expanded={expanded} title={expanded ? '收起工作详情' : '展开工作详情'} onClick={toggleExpanded}>
          {summaryContent}
        </button>
      ) : (
        <div className="chat-work-history__summary">{summaryContent}</div>
      )}
      {expanded && hasDetails ? <div className="chat-work-history__body">{children}</div> : null}
    </div>
  );
}

function AssistantLoadingIndicator({ label, showLabel = true }: { label: string; showLabel?: boolean }) {
  return (
    <div className="chat-assistant-loading" aria-label={label} aria-live="polite">
      <span className="chat-assistant-loading__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {showLabel ? <span>{label}</span> : null}
    </div>
  );
}

function MessageFooter({ actionsDisabled = false, message, align = 'start', onDelete, onEdit, timePosition = 'before-actions' }: { actionsDisabled?: boolean; message: RuntimeMessage; align?: 'start' | 'end'; onDelete?: () => void; onEdit?: () => void; timePosition?: 'before-actions' | 'after-actions' | 'none' }) {
  const [copied, setCopied] = useState(false);
  const copyMessage = async () => {
    if (!message.content) return;
    try {
      await copyTextToClipboard(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const timeNode = (
    <time className="chat-message-footer__time" dateTime={message.createdAt} title={formatTime(message.createdAt)}>
      {formatTime(message.createdAt)}
    </time>
  );
  const actionNodes = (
    <>
      <MessageFooterAction active={copied} disabled={!message.content} label={copied ? '已复制' : '复制'} onClick={() => void copyMessage()}>
        <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
      </MessageFooterAction>
      {onDelete ? (
        <MessageFooterAction disabled={actionsDisabled} label="删除" onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
      {onEdit ? (
        <MessageFooterAction disabled={actionsDisabled} label="编辑" onClick={onEdit}>
          <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
    </>
  );
  return (
    <div className={`chat-message-footer chat-message-footer--${align}`}>
      {timePosition === 'before-actions' ? timeNode : null}
      {actionNodes}
      {timePosition === 'after-actions' ? timeNode : null}
    </div>
  );
}

function MessageFooterAction({ active = false, children, disabled = false, label, onClick }: { active?: boolean; children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <ActionTooltip placement="top" title={label}>
      <button
        className={active ? 'is-copied' : ''}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    </ActionTooltip>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDurationMs(value: number | null): string {
  if (value === null || value < 0) return '';
  const roundedSeconds = Math.round(value / 1000);
  const totalSeconds = value > 0 && roundedSeconds === 0 ? 1 : Math.max(0, roundedSeconds);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}分${seconds}秒` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}小时${restMinutes}分` : `${hours}小时`;
}
