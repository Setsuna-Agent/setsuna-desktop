import { Bubble } from '@ant-design/x';
import {
  normalizeRuntimeReviewNotice,
  type RuntimeMessage,
  type RuntimeReviewModeNotice,
} from '@setsuna-desktop/contracts';
import { BookOpen, MessageSquare, ShieldCheck, Target } from 'lucide-react';
import { useMemo, type FormEvent, type ReactNode } from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import type { DesktopReviewOpenHandler } from '../../workspace/model.js';
import { RuntimeArtifactList } from '../artifacts/RuntimeArtifactList.js';
import { runtimeArtifactsFromToolRuns } from '../artifacts/runtimeArtifacts.js';
import type { RuntimePluginUse } from '../artifacts/runtimePluginUsage.js';
import { RuntimePluginUses } from '../artifacts/RuntimePluginUses.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { SkillReferenceText } from '../skills/SkillReference.js';
import { fileChangeSummaryFromRuns } from '../tool-runs/runtimeFileChanges.js';
import {
  FileChangesSummaryCard,
  RuntimeHookRuns,
  RuntimeToolRuns,
} from '../tool-runs/RuntimeToolRuns.js';
import { isDisplayableRuntimeToolRun } from '../tool-runs/runtimeToolRunVisibility.js';
import { isActiveRuntimeToolRun } from '../tool-runs/runtimeToolRunState.js';
import { formatGoalExitSummary } from '../goalFormatting.js';
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
import { visibleMarkdownContent } from './chatThinkingContent.js';
import { ChatMessageAttachments } from './ChatMessageAttachments.js';
import { ChatMessageFooter } from './ChatMessageFooter.js';
import {
  assistantRunCopyText,
  assistantRunIsActive,
  assistantRunStatus,
  chatDisplayItemRenderKey,
  type ChatDisplayItem,
} from './chatMessageDisplay.js';
import { workHistoryDisplayState } from './chatWorkHistoryState.js';
import {
  ActiveWorkPlaceholder,
  AssistantLoadingIndicator,
  inferWorkTiming,
  WorkHistoryPanel,
} from './ChatWorkHistory.js';
import { ActiveThinkingDisclosure } from './ActiveThinkingDisclosure.js';
import { ContextCompactionStatus } from './ContextCompactionStatus.js';

export { ActiveWorkPlaceholder } from './ChatWorkHistory.js';
export { DeleteSelectionBar } from './ChatDeleteSelectionBar.js';

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
  onOpenFileReview?: DesktopReviewOpenHandler;
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
    return (
      <ReviewModeMarker
        message={item.message}
        onOpenFileReview={onOpenFileReview}
      />
    );
  }
  const { message } = item;
  const streaming = message.status === 'streaming';
  const editing = editingMessageId === message.id;
  const steered = item.steered;
  const assistantItemId = message.turnId ? assistantItemIdByTurnId.get(message.turnId) : undefined;
  const workHistoryExpanded = assistantItemId
    ? hasExpandedWorkHistoryPanel(expandedWorkHistoryItemIds, assistantItemId)
    : false;
  const assistantTimelineSteerMessageIds = new Set(item.assistantTimelineSteerMessageIds);
  const fallbackGuidanceMessages = item.steerMessages
    .filter((steerMessage) => !assistantTimelineSteerMessageIds.has(steerMessage.id));
  // Handled guidance belongs to the assistant work timeline at its real event position. Only keep
  // this fallback for a failed/unhandled steer that has no completed assistant response to own it.
  const showExtractedGuidance = Boolean(!steered && message.turnId && message.turnId !== activeTurnId && !item.guidanceProcessed && fallbackGuidanceMessages.length && !workHistoryExpanded);
  if (editing) {
    return <UserMessageEditor disabled={Boolean(activeTurnId) || editingSubmitting} submitting={editingSubmitting} value={editingDraft} onCancel={onCancelEdit} onChange={onEditDraftChange} onSubmit={() => onSubmitEdit(message.id)} />;
  }
  const hasAttachments = Boolean(message.attachments?.length);
  return (
    <article className={['chat-bubble-item', 'chat-bubble-item--user', deleteMode ? 'chat-bubble-item--selecting' : '', selectedForDelete ? 'is-selected-for-delete' : ''].filter(Boolean).join(' ')}>
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label={t('chat.delete.selectMessage')} onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
      <div className="chat-user-turn">
        <Bubble
          className={`chat-user-bubble ${hasAttachments ? 'chat-user-bubble--with-attachments' : ''}`}
          content={<UserMessageContent message={message} streaming={streaming} />}
          footer={<ChatMessageFooter actionsDisabled={Boolean(activeTurnId) || deleteMode} align="end" message={message} onDelete={steered ? undefined : () => onStartDelete(item.id)} onEdit={steered || message.inputKind === 'goal' || message.inputKind === 'review' ? undefined : () => onStartEdit(message)} timePosition={steered ? 'none' : 'before-actions'} />}
          placement="end"
          variant="filled"
        />
        <RuntimeHookRuns runs={message.hookRuns} />
        {showExtractedGuidance ? <GuidanceMessageList handledMessageIds={new Set(item.handledSteerMessageIds)} messages={fallbackGuidanceMessages} /> : null}
      </div>
    </article>
  );
}

function UserMessageContent({
  message,
  streaming,
}: {
  message: RuntimeMessage;
  streaming: boolean;
}) {
  const hasSemanticKind = message.inputKind === 'goal'
    || message.inputKind === 'review';
  return (
    <div className="chat-user-message-content">
      {message.attachments?.length ? (
        <ChatMessageAttachments attachments={message.attachments} />
      ) : null}
      {message.content || streaming || hasSemanticKind ? (
        <div className="chat-user-message-content__text">
          <UserMessageKindBadge kind={message.inputKind} />
          {message.content || streaming
            ? (
                <span className="chat-user-message-content__body">
                  <SkillReferenceText
                    content={message.content || '...'}
                    skillReferences={message.skillReferences}
                  />
                </span>
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

function UserMessageKindBadge({ kind }: { kind: RuntimeMessage['inputKind'] }) {
  const { t } = useI18n();
  if (kind !== 'goal' && kind !== 'review') return null;
  const label = t(kind === 'goal'
    ? 'chat.message.kind.goal'
    : 'chat.message.kind.review');
  const Icon = kind === 'goal' ? Target : ShieldCheck;
  return (
    <span className={`chat-user-message-kind chat-user-message-kind--${kind}`} aria-label={label}>
      <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </span>
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
  onOpenFileReview?: DesktopReviewOpenHandler;
  onStartDelete: (itemId: string) => void;
  onToggleDelete: (itemId: string, checked: boolean) => void;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  pluginUses: RuntimePluginUse[];
  selectedForDelete: boolean;
}) {
  const { locale, t } = useI18n();
  const status = assistantRunStatus(item);
  const belongsToActiveTurn = assistantRunIsActive(item, activeTurnId);
  const active = belongsToActiveTurn && item.id === activeAssistantItemId;
  const streaming = status === 'streaming' || active;
  const lastSegment = item.segments[item.segments.length - 1];
  const footerMessage = {
    ...(lastSegment ?? item.segments[0]),
    content: assistantRunCopyText(item, t, locale),
  } as RuntimeMessage;
  return (
    <article className={['chat-bubble-item', 'chat-bubble-item--assistant', streaming ? 'chat-bubble-item--active' : '', deleteMode ? 'chat-bubble-item--selecting' : '', selectedForDelete ? 'is-selected-for-delete' : ''].filter(Boolean).join(' ')}>
      {deleteMode ? <MessageSelectionControl checked={selectedForDelete} label={t('chat.delete.selectReply')} onChange={(checked) => onToggleDelete(item.id, checked)} /> : null}
      <Bubble
        className="chat-ai-bubble"
        content={<AssistantRunContent active={active} item={item} onAnswerApproval={onAnswerApproval} onDiscardFileChanges={onDiscardFileChanges} onOpenFileReview={onOpenFileReview} onWorkHistoryExpandedChange={onWorkHistoryExpandedChange} pluginUses={pluginUses} />}
        footer={belongsToActiveTurn ? undefined : <ChatMessageFooter actionsDisabled={Boolean(activeTurnId) || deleteMode} message={footerMessage} onDelete={() => onStartDelete(item.id)} timePosition="after-actions" />}
        placement="start"
        streaming={streaming}
        variant="borderless"
      />
    </article>
  );
}

function UserMessageEditor({ disabled, onCancel, onChange, onSubmit, submitting, value }: { disabled: boolean; onCancel: () => void; onChange: (value: string) => void; onSubmit: () => void; submitting: boolean; value: string }) {
  const { t } = useI18n();
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

function ReviewModeMarker({
  message,
  onOpenFileReview,
}: {
  message: RuntimeMessage;
  onOpenFileReview?: DesktopReviewOpenHandler;
}) {
  const notice = message.reviewMode;
  return notice?.kind === 'exited'
    ? <ReviewSummaryCard notice={notice} onOpenFile={onOpenFileReview} />
    : null;
}

function AssistantRunContent({
  active,
  item,
  onAnswerApproval,
  onDiscardFileChanges,
  onOpenFileReview,
  onWorkHistoryExpandedChange,
  pluginUses,
}: {
  active: boolean;
  item: Extract<ChatDisplayItem, { type: 'assistant' }>;
  onAnswerApproval: AnswerApprovalHandler;
  onDiscardFileChanges?: (filePaths: string[]) => void | Promise<void>;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  pluginUses: RuntimePluginUse[];
}) {
  const { locale, t } = useI18n();
  // The transcript is append-only: collapsing a later write into an earlier row
  // would remove or rewrite work that the user has already seen above it.
  const displaySegments = item.segments;
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
  const hasHiddenOnlyFinalAnswer = !hasFinalAnswerContent && displaySegments.some((segment) => (
    segment.phase === 'final_answer'
    && segment.status !== 'streaming'
    && Boolean(segment.content.trim())
    && !visibleMarkdownContent(segment.content).trim()
  ));
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
        blocks: timelineBlocks,
        guidanceMessages: assistantGuidanceMessages,
        messageOrderIds: item.messageIds,
        workHistoryActive: workHistoryState.active,
      }),
    [active, assistantGuidanceMessages, item.messageIds, timelineBlocks, workHistoryState.active],
  );
  const guidanceBeforeFirstBlock = timelinePlan.placeholderGuidance;
  const leadingGuidance = guidanceBeforeFirstBlock.length ? <GuidanceMessageList handledMessageIds={guidanceMessageIds} markerMode="handled" messages={guidanceBeforeFirstBlock} /> : null;
  const fileChangeSummary = useMemo(() => {
    if (active || !hasFinalAnswerContent) return null;
    return fileChangeSummaryFromRuns(toolRuns);
  }, [active, hasFinalAnswerContent, toolRuns]);
  const memoryCitations = useMemo(() => memoryCitationEntriesFromMessages(displaySegments), [displaySegments]);
  const artifacts = useMemo(() => runtimeArtifactsFromToolRuns(toolRuns), [toolRuns]);
  const goalExitSummary = item.goalExit ? formatGoalExitSummary(item.goalExit, t, locale) : null;
  const reviewExit = item.reviewExit;
  if (!hasRenderableContent && (hasStreamingSegment || active)) {
    return active ? (
      <div className="chat-assistant-run">
        <ActiveWorkPlaceholder segments={displaySegments}>{leadingGuidance}</ActiveWorkPlaceholder>
      </div>
    ) : (
      <AssistantLoadingIndicator label={t('chat.assistant.thinking')} />
    );
  }
  if (planSegment) {
    return (
      <div className="chat-assistant-run">
        {pluginUses.length ? <RuntimePluginUses plugins={pluginUses} /> : null}
        <PlanCard message={planSegment} />
      </div>
    );
  }
  return (
    <div className="chat-assistant-run">
      {showActiveWorkPlaceholder ? (
        <ActiveWorkPlaceholder segments={displaySegments} showLoading={!showTrailingLoading}>
          {leadingGuidance}
        </ActiveWorkPlaceholder>
      ) : leadingGuidance}
      {renderAssistantTimelinePlan({
        active,
        handledGuidanceMessageIds: guidanceMessageIds,
        itemId: chatDisplayItemRenderKey(item),
        onAnswerApproval,
        onWorkHistoryExpandedChange,
        plan: timelinePlan,
        workHistoryDefaultExpanded: workHistoryState.expanded,
        t,
        hideFinalContent: Boolean(reviewExit),
      })}
      {!active && hasHiddenOnlyFinalAnswer && !reviewExit && !goalExitSummary ? (
        <div className="chat-message-error">{t('chat.assistant.noVisibleFinalAnswer')}</div>
      ) : null}
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
      {!active && reviewExit ? (
        <div className="chat-assistant-run__segment">
          <ReviewSummaryCard notice={reviewExit} onOpenFile={onOpenFileReview} />
        </div>
      ) : null}
      {!active && goalExitSummary ? <div className="chat-assistant-run__segment">{goalExitSummary}</div> : null}
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

function PlanCard({ message }: { message: RuntimeMessage }) {
  const { t } = useI18n();
  const planMode = message.planMode;
  if (!planMode) return null;
  const status = planMode.status;
  const streaming = message.status === 'streaming';
  const awaiting = status === 'awaiting_confirmation';
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
      <ChatMessageFooter align="end" message={message} timePosition="none" />
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
  hideFinalContent = false,
}: {
  active: boolean;
  handledGuidanceMessageIds: Set<string>;
  itemId: string;
  onAnswerApproval: AnswerApprovalHandler;
  onWorkHistoryExpandedChange: WorkHistoryExpandedChangeHandler;
  plan: AssistantGuidanceTimelinePlan;
  t: Translate;
  workHistoryDefaultExpanded: boolean;
  hideFinalContent?: boolean;
}): ReactNode[] {
  const nodes: ReactNode[] = [];

  plan.nodes.forEach((node) => {
    if (node.type === 'workHistory') {
      nodes.push(
        assistantWorkHistoryNode({
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

    if (!(hideFinalContent && node.block.type === 'content')) {
      nodes.push(assistantTimelineNode(node.block, active, t));
    }
    if (node.guidanceAfter.length) {
      nodes.push(<GuidanceMessageList handledMessageIds={handledGuidanceMessageIds} key={`${node.block.id}:guidance`} markerMode="handled" messages={node.guidanceAfter} />);
    }
  });

  return nodes;
}

function ReviewSummaryCard({
  notice,
  onOpenFile,
}: {
  notice: RuntimeReviewModeNotice;
  onOpenFile?: DesktopReviewOpenHandler;
}) {
  const { t } = useI18n();
  const normalizedNotice = normalizeRuntimeReviewNotice(notice);
  const findings = normalizedNotice.findings ?? [];
  const summary = normalizedNotice.summary
    || (!findings.length ? normalizedNotice.review : '');

  return (
    <section className="chat-review-summary-card" aria-label={t('chat.review.completed')}>
      {summary ? (
        <MarkdownRenderer
          content={summary}
          legacyThinkingTags={normalizedNotice.reasoningSeparated !== true}
          streaming={false}
        />
      ) : null}
      {findings.length ? (
        <div className="chat-review-summary-card__panel">
          <div className="chat-review-summary-card__header">
            <MessageSquare aria-hidden="true" size={14} />
            <span>{t('chat.review.comments', { count: findings.length })}</span>
          </div>
          <div className="chat-review-summary-card__findings">
            {findings.map((finding, index) => {
              const content = (
                <>
                  <span className="chat-review-summary-card__priority">{finding.priority}</span>
                  <span className="chat-review-summary-card__title">{finding.title}</span>
                </>
              );
              const key = `${finding.path}:${finding.startLine}:${index}`;
              return onOpenFile ? (
                <button
                  className="chat-review-summary-card__finding"
                  key={key}
                  type="button"
                  onClick={() => onOpenFile(
                    finding.path,
                    finding.startLine,
                    finding,
                  )}
                >
                  {content}
                </button>
              ) : (
                <div
                  className="chat-review-summary-card__finding chat-review-summary-card__finding--static"
                  key={key}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function assistantWorkHistoryNode({
  handledGuidanceMessageIds,
  itemId,
  onAnswerApproval,
  onExpandedChange,
  plan,
  workHistoryDefaultExpanded,
}: {
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
    handledGuidanceMessageIds,
  );
  const workTiming = inferWorkTiming(plan.blocks.flatMap((block) => block.segments));
  const hasWorkDetails = workNodes.length > 0;
  if (!hasWorkDetails && !plan.active) return null;
  const workHistoryKey = plan.blocks[0]?.id ?? itemId;
  const panelId = `${itemId}:work-history:${workHistoryKey}`;
  return (
    <WorkHistoryPanel active={plan.active} completedAtMs={workTiming.completedAtMs} defaultExpanded={workHistoryDefaultExpanded} hasDetails={hasWorkDetails} key={panelId} panelId={panelId} startedAtMs={workTiming.startedAtMs} onExpandedChange={onExpandedChange}>
      {workNodes}
    </WorkHistoryPanel>
  );
}

function hasExpandedWorkHistoryPanel(panelIds: Set<string>, itemId: string): boolean {
  if (panelIds.has(itemId)) return true;
  const prefix = `${itemId}:work-history:`;
  return [...panelIds].some((panelId) => panelId.startsWith(prefix));
}

function assistantTimelineNode(block: Exclude<AssistantRunTimelineBlock, { type: 'work' }>, runActive: boolean, t: Translate): ReactNode {
  if (block.type === 'content') {
    return (
      <div className="chat-assistant-run__segment" key={block.id}>
        <MarkdownRenderer
          content={block.content}
          legacyThinkingTags={block.segment.streamParts === undefined}
          streaming={block.segment.status === 'streaming'}
        />
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
  handledGuidanceMessageIds: Set<string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  entries.forEach((entry) => {
    if (entry.type === 'guidance') {
      nodes.push(<GuidanceMessageList handledMessageIds={handledGuidanceMessageIds} key={entry.id} markerMode="handled" messages={entry.messages} />);
      return;
    }
    nodes.push(...assistantWorkItemNodes(entry.item, entry.active, onAnswerApproval));
  });
  return nodes;
}

function assistantWorkItemNodes(
  item: Extract<AssistantRunTimelineBlock, { type: 'work' }>['items'][number],
  itemActive: boolean,
  onAnswerApproval: AnswerApprovalHandler,
): ReactNode[] {
  if (item.type === 'content') {
    return [
      <MarkdownRenderer
        key={item.segment.id}
        content={item.segment.content}
        legacyThinkingTags={item.segment.segment.streamParts === undefined}
        streaming={item.segment.segment.status === 'streaming'}
      />,
    ];
  }
  if (item.type === 'pluginUses') {
    return [<RuntimePluginUses key={item.id} plugins={item.plugins} />];
  }
  if (item.type === 'thinking') {
    return itemActive && item.segment.content.trim()
      ? [
          <ActiveThinkingDisclosure
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
  // 摘要模式只跟随工具自身的生命周期；完成项不应因外层工作区仍活跃
  // 或后续正文出现而改写。
  return visibleToolRuns.length ? [
    <RuntimeToolRuns
      key={item.segment.id}
      runs={visibleToolRuns}
      summaryMode={visibleToolRuns.some(isActiveRuntimeToolRun) ? 'latest' : 'aggregate'}
      onAnswerApproval={onAnswerApproval}
    />,
  ] : [];
}
