import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Bubble, CodeHighlighter } from '@ant-design/x';
import { XMarkdown, type ComponentProps as XMarkdownComponentProps } from '@ant-design/x-markdown';
import { ArrowDown, Copy, Pencil, Trash2 } from 'lucide-react';
import type { RuntimeApprovalDecision, RuntimeConfigState, RuntimeMessage, RuntimeSkillSummary, RuntimeThread, WorkspaceEntrySearchItem, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ChatComposer } from './ChatComposer.js';
import { FileChangesSummaryCard, RuntimeToolRuns } from './RuntimeToolRuns.js';
import { contextTokenUsageFromThread, type ChatContextTokenUsage } from './chatContextUsage.js';
import { assistantRunCopyText, assistantRunIsActive, assistantRunStatus, createChatDisplayItems, type ChatDisplayItem } from './chatMessageDisplay.js';
import { collapseFileMutationRunsInSegments, fileChangeSummaryFromRuns } from './runtimeFileChanges.js';
import '@ant-design/x-markdown/themes/light.css';
import '@ant-design/x-markdown/themes/dark.css';

const scrollBottomThresholdPx = 32;

export function ChatWorkspace({
  activeTurnId,
  activeProject,
  canClearContext,
  config,
  contextCompacting = false,
  currentThread,
  draft,
  skills,
  onCancelActiveTurn,
  onApprovalPolicyChange,
  onAnswerApproval,
  onCompactContext,
  onClearContext,
  onDeleteMessages,
  onDiscardFileChanges,
  onDraftChange,
  onEditUserMessage,
  onOpenFileReview,
  onPermissionProfileChange,
  onSelectModel,
  onSearchProjectEntries,
  onSend,
}: {
  activeTurnId: string | null;
  activeProject?: WorkspaceProject;
  canClearContext: boolean;
  config: RuntimeConfigState | null;
  contextCompacting?: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  skills: RuntimeSkillSummary[];
  onCancelActiveTurn: () => void;
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  onCompactContext: () => void;
  onClearContext: () => void;
  onDeleteMessages: (messageIds: string[]) => void | Promise<void>;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onDraftChange: (value: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onOpenFileReview?: () => void;
  onPermissionProfileChange: (profile: RuntimeConfigState['permissionProfile']) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchItem[]>;
  onSend: (value?: string, options?: { attachments?: RuntimeMessage['attachments']; skillIds?: string[] }) => void;
}) {
  const messages = currentThread?.messages ?? [];
  const displayItems = useMemo(() => createChatDisplayItems(messages), [messages]);
  const contextUsage = useMemo(() => contextTokenUsageFromThread(currentThread), [currentThread]);
  const contextCompactionRunning = contextCompacting || currentThread?.contextCompaction?.status === 'running';
  const showEmptyStarter = displayItems.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [selectedDeleteItemIds, setSelectedDeleteItemIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollSignal = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    const toolRunSignal = messages
      .map((message) => `${message.id}:${message.toolRuns?.map((run) => `${run.id}:${run.status}:${run.resultPreview?.length ?? 0}`).join(',') ?? ''}`)
      .join('|');
    return `${currentThread?.id ?? 'new'}:${messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.status ?? ''}:${lastMessage?.content?.length ?? 0}:${toolRunSignal}`;
  }, [currentThread?.id, messages]);

  const scrollDistanceToBottom = useCallback((node: HTMLDivElement) => Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight), []);
  const syncScrollBottomState = useCallback(() => {
    const node = scrollRef.current;
    if (!node || showEmptyStarter) {
      setShowScrollBottom(false);
      return;
    }
    const nearBottom = scrollDistanceToBottom(node) <= scrollBottomThresholdPx;
    shouldStickToBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
  }, [scrollDistanceToBottom, showEmptyStarter]);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current;
    if (!node) return;
    shouldStickToBottomRef.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setShowScrollBottom(false);
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (showEmptyStarter) {
      node.scrollTop = 0;
      shouldStickToBottomRef.current = false;
      setShowScrollBottom(false);
      return;
    }
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('auto'));
  }, [currentThread?.id, scrollToBottom, showEmptyStarter]);

  useLayoutEffect(() => {
    setEditingMessageId(null);
    setEditingDraft('');
    setEditingSubmitting(false);
    setDeleteMode(false);
    setDeletingMessages(false);
    setSelectedDeleteItemIds(new Set());
    setActionError(null);
  }, [currentThread?.id]);

  useLayoutEffect(() => {
    if (showEmptyStarter) return;
    if (shouldStickToBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom('auto'));
    } else {
      syncScrollBottomState();
    }
  }, [scrollSignal, scrollToBottom, showEmptyStarter, syncScrollBottomState]);

  const selectableDeleteItems = useMemo(
    () =>
      displayItems
        .filter((item) => item.type !== 'context')
        .map((item) => ({
          id: item.id,
          messageIds: item.type === 'assistant' ? item.messageIds : [item.message.id],
          type: item.type,
        })),
    [displayItems],
  );
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
      contextCompacting={contextCompactionRunning}
      contextUsage={contextUsage}
      config={config}
      draft={draft}
      skills={skills}
      starter={starter}
      onCancelActiveTurn={onCancelActiveTurn}
      onApprovalPolicyChange={onApprovalPolicyChange}
      onCompactContext={onCompactContext}
      onClearContext={onClearContext}
      onDraftChange={onDraftChange}
      onPermissionProfileChange={onPermissionProfileChange}
      onSelectModel={onSelectModel}
      onSearchProjectEntries={onSearchProjectEntries}
      onSend={onSend}
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
    <main className="chat-main-panel desktop-chat-panel">
      <div className="chat-main-workspace">
        <div className={`chat-main-conversation ${showEmptyStarter || deleteMode ? '' : 'chat-main-conversation--with-bottom-sender'}`}>
          <div className={`chat-messages ${showEmptyStarter ? 'chat-messages--starter' : ''}`} ref={scrollRef} onScroll={syncScrollBottomState}>
            <div className="chat-content-frame">
              {showEmptyStarter ? (
                <div className="chat-starter">
                  <h1>{starterTitle}</h1>
                  {composer(true)}
                </div>
              ) : (
                <div className="chat-bubble-list">
                  {displayItems.map((item) => (
                    <MessageItem
                      key={item.id}
                      activeTurnId={activeTurnId}
                      deleteMode={deleteMode}
                      editingDraft={editingDraft}
                      editingMessageId={editingMessageId}
                      editingSubmitting={editingSubmitting}
                      item={item}
                      onAnswerApproval={onAnswerApproval}
                      onCancelEdit={cancelEditingMessage}
                      onDiscardFileChanges={onDiscardFileChanges}
                      onEditDraftChange={setEditingDraft}
                      onOpenFileReview={onOpenFileReview}
                      onStartEdit={startEditingMessage}
                      onStartDelete={startDeleteSelection}
                      onSubmitEdit={submitEditingMessage}
                      onToggleDelete={toggleDeleteSelection}
                      selectedForDelete={selectedDeleteItemIds.has(item.id)}
                    />
                  ))}
                  {contextCompactionRunning ? <ContextCompactionDivider active usage={contextUsage} /> : null}
                </div>
              )}
            </div>
          </div>
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

function MessageItem({
  activeTurnId,
  deleteMode,
  editingDraft,
  editingMessageId,
  editingSubmitting,
  item,
  onAnswerApproval,
  onCancelEdit,
  onDiscardFileChanges,
  onEditDraftChange,
  onOpenFileReview,
  onStartEdit,
  onStartDelete,
  onSubmitEdit,
  onToggleDelete,
  selectedForDelete,
}: {
  activeTurnId: string | null;
  deleteMode: boolean;
  editingDraft: string;
  editingMessageId: string | null;
  editingSubmitting: boolean;
  item: ChatDisplayItem;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  onCancelEdit: () => void;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onEditDraftChange: (value: string) => void;
  onOpenFileReview?: () => void;
  onStartEdit: (message: RuntimeMessage) => void;
  onStartDelete: (itemId: string) => void;
  onSubmitEdit: (messageId: string) => void;
  onToggleDelete: (itemId: string, checked: boolean) => void;
  selectedForDelete: boolean;
}) {
  if (item.type === 'assistant') {
    return (
      <AssistantRunItem
        activeTurnId={activeTurnId}
        deleteMode={deleteMode}
        item={item}
        onAnswerApproval={onAnswerApproval}
        onDiscardFileChanges={onDiscardFileChanges}
        onOpenFileReview={onOpenFileReview}
        onStartDelete={onStartDelete}
        onToggleDelete={onToggleDelete}
        selectedForDelete={selectedForDelete}
      />
    );
  }
  if (item.type === 'context') {
    return <ContextCompactionDivider message={item.message} />;
  }
  const { message } = item;
  const streaming = message.status === 'streaming';
  const editing = editingMessageId === message.id;
  if (editing) {
    return (
      <UserMessageEditor
        disabled={Boolean(activeTurnId) || editingSubmitting}
        message={message}
        submitting={editingSubmitting}
        value={editingDraft}
        onCancel={onCancelEdit}
        onChange={onEditDraftChange}
        onSubmit={() => onSubmitEdit(message.id)}
      />
    );
  }
  return (
    <article
      className={[
        'chat-bubble-item',
        'chat-bubble-item--user',
        deleteMode ? 'chat-bubble-item--selecting' : '',
        selectedForDelete ? 'is-selected-for-delete' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {deleteMode ? (
        <MessageSelectionControl
          checked={selectedForDelete}
          label="选择这条消息"
          onChange={(checked) => onToggleDelete(item.id, checked)}
        />
      ) : null}
      <Bubble
        className="chat-user-bubble"
        content={<UserMessageContent message={message} streaming={streaming} />}
        footer={
          <MessageFooter
            actionsDisabled={Boolean(activeTurnId) || deleteMode}
            align="end"
            message={message}
            onDelete={() => onStartDelete(item.id)}
            onEdit={() => onStartEdit(message)}
          />
        }
        placement="end"
        variant="filled"
      />
    </article>
  );
}

function UserMessageContent({ message, streaming }: { message: RuntimeMessage; streaming: boolean }) {
  return (
    <div className="chat-user-message-content">
      {message.content ? <div className="chat-user-message-content__text">{message.content}</div> : streaming ? '...' : null}
      {message.attachments?.length ? (
        <div className="chat-user-message-attachments">
          {message.attachments.map((attachment) => (
            <img key={attachment.id} src={attachment.url} alt={attachment.name} title={attachment.name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantRunItem({
  activeTurnId,
  deleteMode,
  item,
  onAnswerApproval,
  onDiscardFileChanges,
  onOpenFileReview,
  onStartDelete,
  onToggleDelete,
  selectedForDelete,
}: {
  activeTurnId: string | null;
  deleteMode: boolean;
  item: Extract<ChatDisplayItem, { type: 'assistant' }>;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: () => void;
  onStartDelete: (itemId: string) => void;
  onToggleDelete: (itemId: string, checked: boolean) => void;
  selectedForDelete: boolean;
}) {
  const status = assistantRunStatus(item);
  const active = assistantRunIsActive(item, activeTurnId);
  const streaming = status === 'streaming' || active;
  const lastSegment = item.segments[item.segments.length - 1];
  const footerMessage = {
    ...(lastSegment ?? item.segments[0]),
    content: assistantRunCopyText(item),
  } as RuntimeMessage;
  return (
    <article
      className={[
        'chat-bubble-item',
        'chat-bubble-item--assistant',
        streaming ? 'chat-bubble-item--active' : '',
        deleteMode ? 'chat-bubble-item--selecting' : '',
        selectedForDelete ? 'is-selected-for-delete' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {deleteMode ? (
        <MessageSelectionControl
          checked={selectedForDelete}
          label="选择这条回复"
          onChange={(checked) => onToggleDelete(item.id, checked)}
        />
      ) : null}
      <Bubble
        className="chat-ai-bubble"
        content={
          <AssistantRunContent
            active={active}
            item={item}
            onAnswerApproval={onAnswerApproval}
            onDiscardFileChanges={onDiscardFileChanges}
            onOpenFileReview={onOpenFileReview}
          />
        }
        footer={
          active ? undefined : (
            <MessageFooter
              actionsDisabled={Boolean(activeTurnId) || deleteMode}
              message={footerMessage}
              onDelete={() => onStartDelete(item.id)}
              timePosition="after-actions"
            />
          )
        }
        placement="start"
        streaming={streaming}
        variant="borderless"
      />
    </article>
  );
}

function UserMessageEditor({
  disabled,
  message,
  onCancel,
  onChange,
  onSubmit,
  submitting,
  value,
}: {
  disabled: boolean;
  message: RuntimeMessage;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  value: string;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!value.trim() || disabled) return;
    onSubmit();
  };
  return (
    <article className="chat-bubble-item chat-bubble-item--user">
      <form className="chat-user-edit" onSubmit={submit}>
        <textarea
          autoFocus
          disabled={disabled}
          value={value}
          rows={Math.min(8, Math.max(2, value.split('\n').length))}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
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

function MessageSelectionControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="chat-message-select" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}

function ContextCompactionDivider({
  active = false,
  message,
  usage,
}: {
  active?: boolean;
  message?: RuntimeMessage;
  usage?: ChatContextTokenUsage;
}) {
  const notice = message?.contextCompaction;
  const count = notice?.compactedMessageCount ?? 0;
  const percentValue = usage ? Math.min(100, Math.max(0, Number(usage.visiblePercent || usage.percent || 0))) : 0;
  const percentLabel = percentValue > 0 ? `${percentValue.toFixed(percentValue > 0 && percentValue < 1 ? 1 : 0)}%` : '';
  const label = active
    ? `正在压缩上下文${percentLabel ? ` · ${percentLabel}` : ''}`
    : count > 0 ? `已压缩 ${count} 条上下文` : '已压缩上下文';
  return (
    <div className="chat-context-compact-divider" aria-label="上下文压缩">
      <span className="chat-context-compact-divider__line" />
      <span className={['chat-context-compact-divider__text', active ? 'chat-context-compact-divider__text--active' : ''].filter(Boolean).join(' ')}>
        {label}
      </span>
      <span className="chat-context-compact-divider__line" />
    </div>
  );
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
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allChecked}
            disabled={loading || totalCount === 0}
            onChange={(event) => onToggleAll(event.currentTarget.checked)}
          />
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
}: {
  active: boolean;
  item: Extract<ChatDisplayItem, { type: 'assistant' }>;
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: () => void;
}) {
  const displaySegments = useMemo(() => collapseFileMutationRunsInSegments(item.segments), [item.segments]);
  const hasRenderableContent = displaySegments.some((segment) => segment.content.trim() || segment.toolRuns?.length || segment.error);
  const status = assistantRunStatus(item);
  const hasStreamingSegment = displaySegments.some((segment) => segment.status === 'streaming');
  const hasPendingApproval = displaySegments.some((segment) => segment.toolRuns?.some(isPendingApprovalToolRun));
  const showContinuationLoading = active && status !== 'error' && !hasStreamingSegment && !hasPendingApproval;
  const fileChangeSummary = useMemo(() => {
    if (active) return null;
    return fileChangeSummaryFromRuns(displaySegments.flatMap((segment) => segment.toolRuns ?? []));
  }, [active, displaySegments]);
  if (!hasRenderableContent && (status === 'streaming' || active)) {
    return <AssistantLoadingIndicator label={active ? '正在处理' : '思考中'} />;
  }
  const contentNodes = assistantRunContentNodes(displaySegments, onAnswerApproval);
  return (
    <div className="chat-assistant-run">
      {contentNodes}
      {fileChangeSummary ? (
        <div className="chat-assistant-run__segment">
          <FileChangesSummaryCard summary={fileChangeSummary} onDiscardChanges={onDiscardFileChanges} onOpenReview={onOpenFileReview} />
        </div>
      ) : null}
      {showContinuationLoading ? <AssistantLoadingIndicator label="继续处理" /> : null}
    </div>
  );
}

function assistantRunContentNodes(
  segments: RuntimeMessage[],
  onAnswerApproval: (approvalId: string, decision: RuntimeApprovalDecision) => void,
) {
  const nodes: JSX.Element[] = [];
  let pendingToolRuns: NonNullable<RuntimeMessage['toolRuns']> = [];
  let pendingToolKeyParts: string[] = [];

  const flushToolRuns = () => {
    if (!pendingToolRuns.length) return;
    nodes.push(
      <div className="chat-assistant-run__segment" key={`tools-${pendingToolKeyParts.join('-')}`}>
        <RuntimeToolRuns runs={pendingToolRuns} onAnswerApproval={onAnswerApproval} />
      </div>,
    );
    pendingToolRuns = [];
    pendingToolKeyParts = [];
  };

  for (const segment of segments) {
    if (segment.content.trim()) {
      flushToolRuns();
      nodes.push(
        <div className="chat-assistant-run__segment" key={`${segment.id}-content`}>
          <MarkdownContent content={segment.content} streaming={segment.status === 'streaming'} />
        </div>,
      );
    }

    if (segment.toolRuns?.length) {
      pendingToolRuns.push(...segment.toolRuns);
      pendingToolKeyParts.push(segment.id);
    }

    if (isEmptyStreamingAssistantSegment(segment)) {
      flushToolRuns();
      nodes.push(
        <div className="chat-assistant-run__segment" key={`${segment.id}-loading`}>
          <AssistantLoadingIndicator label="正在处理" />
        </div>,
      );
    }

    if (segment.error) {
      flushToolRuns();
      nodes.push(
        <div className="chat-assistant-run__segment" key={`${segment.id}-error`}>
          <div className="chat-message-error">{segment.error}</div>
        </div>,
      );
    }
  }

  flushToolRuns();
  return nodes;
}

function isEmptyStreamingAssistantSegment(segment: RuntimeMessage): boolean {
  return segment.status === 'streaming' && !segment.content.trim() && !segment.toolRuns?.length && !segment.error;
}

function isPendingApprovalToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected';
}

function AssistantLoadingIndicator({ label }: { label: string }) {
  return (
    <div className="chat-assistant-loading" aria-live="polite">
      <span className="chat-assistant-loading__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{label}</span>
    </div>
  );
}

function MessageFooter({
  actionsDisabled = false,
  message,
  align = 'start',
  onDelete,
  onEdit,
  timePosition = 'before-actions',
}: {
  actionsDisabled?: boolean;
  message: RuntimeMessage;
  align?: 'start' | 'end';
  onDelete?: () => void;
  onEdit?: () => void;
  timePosition?: 'before-actions' | 'after-actions';
}) {
  const [copied, setCopied] = useState(false);
  const copyMessage = async () => {
    if (!message.content) return;
    try {
      await copyText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const timeNode = <time>{formatTime(message.createdAt)}</time>;
  const actionNodes = (
    <>
      <button
        className={copied ? 'is-copied' : ''}
        type="button"
        aria-label={copied ? '已复制' : '复制'}
        title={copied ? '已复制' : '复制'}
        disabled={!message.content}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void copyMessage();
        }}
      >
        <Copy size={13} />
      </button>
      {onDelete ? (
        <button
          type="button"
          aria-label="删除"
          title="删除"
          disabled={actionsDisabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          aria-label="编辑"
          title="编辑"
          disabled={actionsDisabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
        >
          <Pencil size={13} />
        </button>
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

function MarkdownContent({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <XMarkdown
      className="chat-markdown x-markdown-light"
      content={content}
      components={{ code: MarkdownCode }}
      openLinksInNewTab
      style={markdownStyle}
      streaming={{
        hasNextChunk: streaming,
        enableAnimation: streaming,
        tail: streaming ? { content: '|' } : false,
      }}
    />
  );
}

function MarkdownCode({ block, children, className, lang }: XMarkdownComponentProps) {
  const code = String(children || '');
  if (!block) return <code className={className}>{children}</code>;
  const language = lang?.split(/\s+/)[0] || className?.match(/language-([\w-]+)/)?.[1] || '';
  return (
    <CodeHighlighter
      className="chat-code-highlighter"
      header={<div className="chat-code-highlighter__header">{(language || 'text').toUpperCase()}</div>}
      lang={normalizeCodeLanguage(language)}
      prismLightMode={false}
    >
      {code.replace(/\n$/, '')}
    </CodeHighlighter>
  );
}

const markdownStyle = {
  '--border-color': 'var(--app-border)',
  '--code-inline-text': 'calc(var(--app-font-size, 14px) - 1px)',
  '--dark-bg': 'var(--chat-code-bg)',
  '--font-size': 'var(--app-font-size, 14px)',
  '--heading-color': 'var(--app-text)',
  '--light-bg': '#fafafa',
  '--line-color': 'var(--app-border)',
  '--primary-color': 'var(--app-primary)',
  '--table-body-bg': 'var(--app-surface)',
  '--table-head-bg': 'color-mix(in srgb, var(--app-text) 5%, var(--app-surface))',
  '--text-color': 'var(--app-text)',
  fontFamily: 'var(--app-font-family)',
  fontFeatureSettings: '"kern"',
  fontSize: 'var(--app-font-size, 14px)',
  fontWeight: 400,
  lineHeight: 1.72,
  textRendering: 'optimizeLegibility',
  WebkitFontSmoothing: 'antialiased',
} as CSSProperties;

const codeLanguageAliases: Record<string, string> = {
  cjs: 'javascript',
  htm: 'markup',
  html: 'markup',
  js: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'markup',
  yml: 'yaml',
  zsh: 'bash',
};

function normalizeCodeLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  return codeLanguageAliases[normalized] || normalized;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('Copy failed');
}
