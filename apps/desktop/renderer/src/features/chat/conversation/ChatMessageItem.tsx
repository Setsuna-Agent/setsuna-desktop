import { Bubble } from '@ant-design/x';
import type { RuntimeMessage, RuntimePlanDecision } from '@setsuna-desktop/contracts';
import { BookOpen, Copy, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n, type AppLocale, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';
import { ActionTooltip } from '../../../shared/ui/primitives.js';
import { RuntimeArtifactList } from '../artifacts/RuntimeArtifactList.js';
import { runtimeArtifactsFromToolRuns } from '../artifacts/runtimeArtifacts.js';
import { type RuntimePluginUse } from '../artifacts/runtimePluginUsage.js';
import { RuntimePluginUses } from '../artifacts/RuntimePluginUses.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { WorkspaceMentionText } from '../mentions/WorkspaceMentionText.js';
import { collapseFileMutationRunsInSegments, fileChangeSummaryFromRuns } from '../tool-runs/runtimeFileChanges.js';
import {
  FileChangesSummaryCard,
  RuntimeHookRuns,
  RuntimeToolRuns,
  isDisplayableRuntimeToolRun,
  type ToolRunSummaryMode,
} from '../tool-runs/RuntimeToolRuns.js';
import type { AnswerApprovalHandler, WorkHistoryExpandedChangeHandler } from './chat-workspace-types.js';
import {
  createAssistantGuidanceTimelinePlan,
  type AssistantGuidanceTimelinePlan,
  type AssistantWorkHistoryPlanEntry,
} from './chatAssistantGuidanceTimeline.js';
import {
  createAssistantRunTimeline,
  shouldShowAssistantTrailingLoading,
  type AssistantRunTimelineBlock,
} from './chatAssistantTimeline.js';
import { memoryCitationEntriesFromMessages } from './chatMemoryCitations.js';
import { ChatMessageAttachments } from './ChatMessageAttachments.js';
import {
  assistantRunCopyText,
  assistantRunIsActive,
  assistantRunStatus,
  chatDisplayItemRenderKey,
  type ChatDisplayItem,
} from './chatMessageDisplay.js';
import { hasThinkingSegments } from './chatThinkingContent.js';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';
import { workHistoryDisplayState } from './chatWorkHistoryState.js';
import { ContextCompactionStatus } from './ContextCompactionStatus.js';
import { useStreamingScrollPin } from './useStreamingScrollPin.js';

export function MessageItem({
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
  const { t } = useI18n();
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
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label={t('chat.delete.selectMessage')} onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
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
  const { t } = useI18n();
  const status = assistantRunStatus(item);
  const belongsToActiveTurn = assistantRunIsActive(item, activeTurnId);
  const active = belongsToActiveTurn && item.id === activeAssistantItemId;
  const streaming = status === 'streaming' || active;
  const lastSegment = item.segments[item.segments.length - 1];
  const footerMessage = {
    ...(lastSegment ?? item.segments[0]),
    content: assistantRunCopyText(item, t),
  } as RuntimeMessage;
  return (
    <article className={['chat-bubble-item', 'chat-bubble-item--assistant', streaming ? 'chat-bubble-item--active' : '', deleteMode ? 'chat-bubble-item--selecting' : '', selectedForDelete ? 'is-selected-for-delete' : ''].filter(Boolean).join(' ')}>
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label={t('chat.delete.selectReply')} onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
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
  const { locale, t } = useI18n();
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
          <time>{formatTime(message.createdAt, locale)}</time>
          <span className="chat-user-edit__actions">
            <button type="button" disabled={disabled} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={disabled || !value.trim()}>
              {submitting ? t('chat.message.sending') : t('chat.composer.send')}
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
  const { t } = useI18n();
  const notice = message.reviewMode;
  if (!notice) return null;
  const label = notice.kind === 'entered'
    ? t('chat.review.started', { review: notice.review })
    : t('chat.review.completed');
  return (
    <div className="chat-review-mode-marker" aria-label={label}>
      <span className="chat-review-mode-marker__line" />
      <span className="chat-review-mode-marker__text">{label}</span>
    </div>
  );
}

export function TranscriptWindowDivider({ hiddenMessageCount, onShowAll }: { hiddenMessageCount: number; onShowAll: () => void }) {
  const { t } = useI18n();
  const count = Math.max(0, hiddenMessageCount);
  return (
    <ChatTimelineDivider
      accessibilityLabel={t('chat.history.collapsedLabel')}
      label={count > 0 ? t('chat.history.collapsedCount', { count }) : t('chat.history.collapsed')}
      onClick={onShowAll}
    />
  );
}

export function DeleteSelectionBar({
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
  const { t } = useI18n();
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className="chat-delete-bar">
      <div className="chat-delete-bar__inner">
        <label className="chat-delete-bar__select-all">
          <input ref={checkboxRef} type="checkbox" checked={allChecked} disabled={loading || totalCount === 0} onChange={(event) => onToggleAll(event.currentTarget.checked)} />
          <span>{t('chat.delete.selectAll')}</span>
        </label>
        <span className="chat-delete-bar__count">{t('chat.delete.selected', { count: selectedCount })}</span>
        <button type="button" className="chat-delete-bar__cancel" disabled={loading} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="chat-delete-bar__confirm" disabled={disabled} onClick={onConfirm}>
          {loading ? t('chat.delete.deleting') : t('common.delete')}
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
  const { t } = useI18n();
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
  // 工具行本身已经提供实时进度，只有模型继续处理且没有活动工具时才显示尾部等待反馈。
  const showTrailingLoading = shouldShowAssistantTrailingLoading({
    active,
    hasRenderableContent,
    status,
    toolRuns,
  });
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
      <AssistantLoadingIndicator label={t('chat.assistant.thinking')} />
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
        t,
      })}
      {toolAttachments.length ? (
        <div className="chat-assistant-run__segment chat-assistant-run__attachments">
          <ChatMessageAttachments attachments={toolAttachments} variant="assistant" />
        </div>
      ) : null}
      {showTrailingLoading ? <AssistantLoadingIndicator label={t('chat.assistant.processing')} showLabel={false} /> : null}
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
  const { t } = useI18n();

  return (
    <details className="chat-memory-citations">
      <summary>
        <BookOpen size={13} />
        <span>{t('chat.memory.used', { count: entries.length })}</span>
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
  const { t } = useI18n();
  const planMode = message.planMode;
  if (!planMode) return null;
  const status = planMode.status;
  const streaming = message.status === 'streaming';
  const awaiting = status === 'awaiting_confirmation';
  const canDecide = awaiting && !active;
  const statusLabel = awaiting
    ? t('chat.plan.awaiting')
    : status === 'accepted'
      ? t('chat.plan.accepted')
      : t('chat.plan.dismissed');
  const body = message.content.trim()
    ? <MarkdownRenderer content={message.content} streaming={streaming} />
    : streaming
      ? <AssistantLoadingIndicator label={t('chat.plan.drafting')} />
      : null;
  return (
    <section className={`chat-plan-card chat-plan-card--${status}${streaming ? ' is-streaming' : ''}`}>
      <header className="chat-plan-card__header">
        <span className="chat-plan-card__title">{t('chat.plan.title')}</span>
        <span className={`chat-plan-card__status chat-plan-card__status--${status}`}>{statusLabel}</span>
      </header>
      <div className="chat-plan-card__body">{body}</div>
      {canDecide ? (
        <footer className="chat-plan-card__actions">
          <button type="button" className="chat-plan-card__action chat-plan-card__action--accept" onClick={() => onPlanDecision('accepted')}>
            {t('chat.plan.accept')}
          </button>
          <button type="button" className="chat-plan-card__action chat-plan-card__action--dismiss" onClick={() => onPlanDecision('dismissed')}>
            {t('chat.plan.dismiss')}
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
  const { t } = useI18n();

  return (
    <div className="chat-guidance-marker" aria-label={t('chat.guidance.processed')}>
      {t('chat.guidance.processed')}
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
  t,
  workHistoryDefaultExpanded,
}: {
  active: boolean;
  handledGuidanceMessageIds: Set<string>;
  itemId: string;
  onAnswerApproval: AnswerApprovalHandler;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  plan: AssistantGuidanceTimelinePlan;
  t: Translate;
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

    nodes.push(assistantTimelineNode(node.block, active, t));
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

function assistantTimelineNode(block: Exclude<AssistantRunTimelineBlock, { type: 'work' }>, runActive: boolean, t: Translate): ReactNode {
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
        <AssistantLoadingIndicator label={t('chat.assistant.processing')} />
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

export function ActiveWorkPlaceholder({
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
  const { t } = useI18n();

  return (
    <WorkHistoryPanel active completedAtMs={null} hasDetails={Boolean(children) || pluginUses.length > 0 || showLoading} startedAtMs={inferActiveTurnStartedAtMs(segments)}>
      <RuntimePluginUses active plugins={pluginUses} />
      {children}
      {/* runtime 尚未产出内容时，在工作区内保留明确的进行中反馈。 */}
      {showLoading ? <AssistantLoadingIndicator label={t('chat.assistant.processing')} showLabel={false} /> : null}
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
  const { t } = useI18n();
  const { handlePointerDown, handleScroll, handleTouchMove, handleWheel, scrollRef } = useStreamingScrollPin(content, scrollStateKey);

  return (
    <div className="chat-thinking-box" aria-live="polite" aria-label={t('chat.thinking.active')}>
      <div className="chat-thinking-box__content" ref={scrollRef} onPointerDownCapture={handlePointerDown} onScroll={handleScroll} onTouchMoveCapture={handleTouchMove} onWheelCapture={handleWheel}>
        <MarkdownRenderer content={content} streaming />
      </div>
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
  const { t } = useI18n();
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

  const title = active ? t('chat.work.active') : t('chat.work.completed');
  const durationEndMs = active ? nowMs : (capturedCompletedAtMs ?? completedAtMs ?? null);
  const durationLabel = formatDurationMs(
    startedAtMs !== null && startedAtMs !== undefined && durationEndMs !== null
      ? Math.max(0, durationEndMs - startedAtMs)
      : null,
    t,
  );
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
        <button className="chat-work-history__summary" type="button" aria-expanded={expanded} title={expanded ? t('chat.work.collapse') : t('chat.work.expand')} onClick={toggleExpanded}>
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
  const { locale, t } = useI18n();
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
    <time className="chat-message-footer__time" dateTime={message.createdAt} title={formatTime(message.createdAt, locale)}>
      {formatTime(message.createdAt, locale)}
    </time>
  );
  const actionNodes = (
    <>
      <MessageFooterAction active={copied} disabled={!message.content} label={copied ? t('chat.message.copied') : t('chat.message.copy')} onClick={() => void copyMessage()}>
        <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
      </MessageFooterAction>
      {onDelete ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('common.delete')} onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
      {onEdit ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('chat.message.edit')} onClick={onEdit}>
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

function formatTime(value: string, locale: AppLocale): string {
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatDurationMs(value: number | null, t: Translate): string {
  if (value === null || value < 0) return '';
  const roundedSeconds = Math.round(value / 1000);
  const totalSeconds = value > 0 && roundedSeconds === 0 ? 1 : Math.max(0, roundedSeconds);
  if (totalSeconds < 60) return t('chat.duration.seconds', { seconds: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds
      ? t('chat.duration.minutesSeconds', { minutes, seconds })
      : t('chat.duration.minutes', { minutes });
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes
    ? t('chat.duration.hoursMinutes', { hours, minutes: restMinutes })
    : t('chat.duration.hours', { hours });
}
