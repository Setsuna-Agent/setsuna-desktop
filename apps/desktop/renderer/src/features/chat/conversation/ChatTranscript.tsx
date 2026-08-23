import type {
  RuntimeMessage,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { ArrowDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { DesktopReviewOpenHandler, DesktopReviewState } from '../../workspace/model.js';
import { runtimePluginUsesByTurn } from '../artifacts/runtimePluginUsage.js';
import { useChatMessageOperations } from '../hooks/useChatMessageOperations.js';
import { useThreadMessageHistory } from '../hooks/useThreadMessageHistory.js';
import { MarkdownViewportProvider } from '../markdown/MarkdownViewportProvider.js';
import { SkillReferenceCatalogProvider } from '../skills/SkillReference.js';
import {
  ActiveWorkPlaceholder,
  DeleteSelectionBar,
  MessageItem,
} from './ChatMessageItem.js';
import { TranscriptWindowDivider } from './TranscriptWindowDivider.js';
import {
  ChatScrollOverlay,
  usePinnedChatScroll,
} from './ChatWorkspaceScroll.js';
import { ContextCompactionStatus } from './ContextCompactionStatus.js';
import { StreamingScrollPinProvider } from './StreamingScrollPinProvider.js';
import { ChatThreadProvider } from './ChatThreadProvider.js';
import type { AnswerApprovalHandler, WorkHistoryExpandedChangeHandler } from './chat-workspace-types.js';
import {
  activeAssistantRunItemId,
  chatDisplayItemRenderKey,
  createChatDisplayItems,
  createChatRenderWindow,
  createChatScrollSignal,
} from './chatMessageDisplay.js';

export type ChatTranscriptMessageHistory = ReturnType<typeof useThreadMessageHistory>;

type ChatTranscriptMutationProps =
  | {
      readOnly: true;
      onDeleteMessages?: never;
      onDeleteModeChange?: never;
      onEditUserMessage?: never;
    }
  | {
      readOnly?: false;
      onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
      onDeleteModeChange?: (active: boolean) => void;
      onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
    };

type ChatTranscriptProps = ChatTranscriptMutationProps & {
  activeTurnId: string | null;
  contextCompactionRunning: boolean;
  contentRef: React.RefObject<HTMLDivElement>;
  currentThread: RuntimeThread | null;
  messageHistory: ChatTranscriptMessageHistory;
  messages: RuntimeMessage[];
  onAnswerApproval: AnswerApprovalHandler;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: DesktopReviewOpenHandler;
  plugins: RuntimePluginSummary[];
  reviewState?: DesktopReviewState | null;
  scrollToBottomRef?: React.MutableRefObject<(() => void) | null>;
  showEmptyStarter?: boolean;
  showThinkingInTranscript: boolean;
  skills: RuntimeSkillSummary[];
  starterContent?: ReactNode;
};

/**
 * 只读 + 主对话共用的消息流渲染：展示项、分页历史、滚动锚定、工具运行、
 * 审批按钮与删除/编辑交互。Subagent 面板通过 readOnly 关闭删除/编辑入口。
 *
 * 组件不拥有数据 hook；messages 与 messageHistory 由父级提供，滚动锚定所需的
 * contentRef 也由父级注入，以便外层 conversation overview 复用同一 DOM 节点。
 */
export function ChatTranscript({
  activeTurnId,
  contextCompactionRunning,
  contentRef,
  currentThread,
  messageHistory,
  messages,
  onAnswerApproval,
  onDeleteMessages,
  onDeleteModeChange,
  onDiscardFileChanges,
  onEditUserMessage,
  onOpenFileReview,
  plugins,
  readOnly = false,
  reviewState = null,
  showEmptyStarter = false,
  showThinkingInTranscript,
  skills,
  starterContent,
  scrollToBottomRef,
}: ChatTranscriptProps) {
  const { t } = useI18n();
  const historyThread = useMemo(
    () => currentThread ? { ...currentThread, messages } : null,
    [currentThread, messages],
  );
  const displayItems = useMemo(() => createChatDisplayItems(messages), [messages]);
  const historyScrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const pluginUsesByTurnId = useMemo(
    () => runtimePluginUsesByTurn(historyThread, skills, plugins),
    [historyThread, plugins, skills],
  );
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
    composerKey: readOnly ? `subagent-readonly:${currentThread?.id ?? 'none'}` : 'chat-transcript',
    currentThreadId: currentThread?.id,
    displayItems,
    onDeleteMessages,
    onEditUserMessage,
    readOnly,
  });
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [expandedWorkHistoryItemIds, setExpandedWorkHistoryItemIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    historyScrollAnchorRef.current = null;
    setShowFullHistory(false);
    setExpandedWorkHistoryItemIds(new Set());
  }, [currentThread?.id]);
  useEffect(() => {
    onDeleteModeChange?.(readOnly ? false : deleteMode);
  }, [deleteMode, onDeleteModeChange, readOnly]);
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
  const messageMutationHandlers = readOnly
    ? {}
    : {
        onStartEdit: startEditingMessage,
        onStartDelete: startDeleteSelection,
        onSubmitEdit: submitEditingMessage,
        onToggleDelete: toggleDeleteSelection,
      };
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
  const { handleScroll, handleScrollKeyDown, handleScrollTouchMove, handleScrollWheel, listRef, markScrollbarDragIntent, scrollRef: scrollRefInternal, scrollToBottom, showScrollBottom } = usePinnedChatScroll({
    contentRef,
    scrollSignal,
    showEmptyStarter,
    threadId: currentThread?.id ?? null,
  });
  useLayoutEffect(() => {
    if (scrollToBottomRef) scrollToBottomRef.current = scrollToBottom;
    return () => {
      if (scrollToBottomRef) scrollToBottomRef.current = null;
    };
  }, [scrollToBottom, scrollToBottomRef]);
  const showEarlierMessages = useCallback(() => {
    const scrollNode = scrollRefInternal.current;
    if (scrollNode) {
      historyScrollAnchorRef.current = {
        height: scrollNode.scrollHeight,
        top: scrollNode.scrollTop,
      };
    }
    setShowFullHistory(true);
    if (messageHistory.hasMore) void messageHistory.loadOlder();
  }, [messageHistory.hasMore, messageHistory.loadOlder, scrollRefInternal]);

  useLayoutEffect(() => {
    const anchor = historyScrollAnchorRef.current;
    const scrollNode = scrollRefInternal.current;
    if (!anchor || !scrollNode) return;
    // Prepending a page must not move the message currently under the user's cursor.
    scrollNode.scrollTop = anchor.top + (scrollNode.scrollHeight - anchor.height);
    if (!messageHistory.loading) historyScrollAnchorRef.current = null;
  }, [messageHistory.loading, messages.length, scrollRefInternal, showFullHistory]);

  return (
    <>
      <div className={`chat-messages ${showEmptyStarter ? 'chat-messages--starter' : ''}`} ref={scrollRefInternal} onKeyDownCapture={handleScrollKeyDown} onPointerDownCapture={markScrollbarDragIntent} onScroll={handleScroll} onTouchMoveCapture={handleScrollTouchMove} onWheelCapture={handleScrollWheel}>
        <MarkdownViewportProvider scrollRef={scrollRefInternal}>
          <div className="chat-content-frame" ref={contentRef}>
            {showEmptyStarter ? (
              starterContent
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
                          {...messageMutationHandlers}
                          activeAssistantItemId={activeAssistantItemId}
                          activeTurnId={activeTurnId}
                          assistantItemIdByTurnId={assistantItemIdByTurnId}
                          deleteMode={!readOnly && deleteMode}
                          editingDraft={editingDraft}
                          editingMessageId={readOnly ? null : editingMessageId}
                          editingSubmitting={editingSubmitting}
                          expandedWorkHistoryItemIds={expandedWorkHistoryItemIds}
                          item={item}
                          onAnswerApproval={onAnswerApproval}
                          onCancelEdit={cancelEditingMessage}
                          onDiscardFileChanges={reviewState?.isGitRepository ? onDiscardFileChanges : undefined}
                          onEditDraftChange={setEditingDraft}
                          onOpenFileReview={onOpenFileReview}
                          onWorkHistoryExpandedChange={handleWorkHistoryExpandedChange}
                          pluginUses={item.type === 'assistant' && item.turnId ? (pluginUsesByTurnId.get(item.turnId) ?? []) : []}
                          selectedForDelete={!readOnly && selectedDeleteItemIds.has(item.id)}
                          showThinkingInTranscript={showThinkingInTranscript}
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
      <ChatScrollOverlay disabled={showEmptyStarter} scrollRef={scrollRefInternal} scrollSignal={scrollSignal} />
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
      {showEmptyStarter || readOnly ? null : deleteMode ? (
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
      ) : null}
    </>
  );
}
