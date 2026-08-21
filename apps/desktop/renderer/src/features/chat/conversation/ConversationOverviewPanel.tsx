import type {
  RuntimeCollaborationTask,
  RuntimeThread,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChevronUp, CircleGauge, FileDiff } from 'lucide-react';
import { formatTokens, type DesktopReviewState } from '../../workspace/model.js';
import { localReviewChangeStats } from '../../workspace/reviewChanges.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { AppTooltip } from '../../../shared/ui/primitives.js';
import { ChangeCountText } from './ChangeCountText.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationBackgroundServices, type BackgroundShellProcessClient } from './ConversationBackgroundServices.js';
import { ConversationGitControls } from './ConversationGitControls.js';
import { ConversationPlanSummary } from './ConversationPlanSummary.js';
import { AgentAvatar } from '../../chat/subagents/AgentAvatar.js';
import { SubagentTaskStatus } from '../../chat/subagents/SubagentTaskStatus.js';

export function ConversationOverviewPanel({
  activeProject,
  compact,
  contextLabel,
  contextPercent,
  currentThread,
  overview,
  shellProcessClient,
  reviewLoading,
  reviewState,
  threadUsage,
  onCollapse,
  onExpand,
  onOpenReview,
  onOpenSubagent,
  onReviewRefresh,
  reviewError,
}: {
  activeProject?: WorkspaceProject;
  compact: boolean;
  contextLabel: string;
  contextPercent: number;
  currentThread: RuntimeThread;
  overview: ConversationOverviewState;
  shellProcessClient?: BackgroundShellProcessClient;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  threadUsage: RuntimeUsageResponse | null;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenReview?: () => void;
  onOpenSubagent?: (task: RuntimeCollaborationTask) => void;
  onReviewRefresh?: () => void | Promise<void>;
  reviewError: string | null;
}) {
  const { t } = useI18n();
  const changeStats = reviewState?.isGitRepository
    ? localReviewChangeStats(reviewState)
    : {
        additions: overview.fileChangeSummary?.additions ?? 0,
        deletions: overview.fileChangeSummary?.deletions ?? 0,
        fileCount: overview.fileChangeSummary?.files.length ?? 0,
      };
  const hasFileChanges = changeStats.fileCount > 0;
  // The first status read is pending before its effect has flipped reviewLoading on.
  const reviewPending = Boolean(activeProject && !reviewState && !reviewError);
  const reviewFailed = Boolean(activeProject && !reviewState && reviewError);
  const usageSummary = threadUsage?.summary;
  // 协作任务以父线程账本为准，不再从 threads.filter(parentThreadId) 猜状态。
  const collaborationTasks = currentThread.collaborationTasks ?? [];
  const callCount = usageSummary?.recordCount ?? 0;
  const totalTokensLabel = formatTokens(usageSummary?.totalTokens ?? 0);
  const cacheHitRateLabel = formatCacheHitRate(usageSummary?.cachedInputTokens ?? 0, usageSummary?.inputTokens ?? 0);
  const callCountLabel = t(callCount === 1 ? 'conversation.overview.callCount.one' : 'conversation.overview.callCount.many', { count: callCount });
  const usageSummaryLabel = [totalTokensLabel, cacheHitRateLabel, callCountLabel].join(' · ');

  if (compact) {
    return (
      <button className="chat-conversation-overview-chip" type="button" aria-label={t('conversation.overview.expand')} onClick={onExpand}>
        <FileDiff size={13} />
        <span>{hasFileChanges ? t('conversation.overview.changes') : t('conversation.overview.environment')}</span>
        {hasFileChanges ? (
          <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
        ) : (
          <span className="chat-conversation-overview-chip__meta">{contextLabel}</span>
        )}
      </button>
    );
  }

  return (
    <section className="chat-conversation-overview-panel" aria-label={t('conversation.overview.title')}>
      <div className="chat-conversation-overview-panel__header">
        <span>{t('conversation.overview.title')}</span>
        <button type="button" aria-label={t('conversation.overview.collapse')} title={t('conversation.overview.collapse')} onClick={onCollapse}>
          <ChevronUp aria-hidden="true" size={15} />
        </button>
      </div>
      <div className="chat-conversation-overview-panel__actions">
        <button
          type="button"
          className="chat-conversation-overview-panel__row"
          disabled={!onOpenReview}
          onClick={() => onOpenReview?.()}
        >
          <span className="chat-conversation-overview-panel__icon">
            <FileDiff size={14} />
          </span>
          <span className="chat-conversation-overview-panel__label">{t('conversation.overview.changes')}</span>
          <span className="chat-conversation-overview-panel__meta" title={reviewFailed ? reviewError ?? undefined : undefined}>
            {hasFileChanges ? (
              <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
            ) : reviewPending ? t('conversation.overview.loading') : reviewFailed ? t('conversation.overview.loadFailed') : t('conversation.overview.noChanges')}
          </span>
        </button>
        <ConversationGitControls
          activeProject={activeProject}
          reviewError={reviewError}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          onReviewRefresh={onReviewRefresh}
        />
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon">
            <ContextProgressIcon percent={contextPercent} />
          </span>
          <span className="chat-conversation-overview-panel__label">{t('conversation.overview.context')}</span>
          <span className="chat-conversation-overview-panel__meta">{contextLabel}</span>
        </div>
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon"><CircleGauge size={14} /></span>
          <span className="chat-conversation-overview-panel__label">{t('conversation.overview.usageDiagnostics')}</span>
          <AppTooltip
            placement="left"
            title={(
              <UsageSummaryTooltipContent
                cacheHitRate={cacheHitRateLabel}
                callCount={callCountLabel}
                totalTokens={totalTokensLabel}
              />
            )}
          >
            <span className="chat-conversation-overview-panel__meta">
              {usageSummaryLabel}
            </span>
          </AppTooltip>
        </div>
      </div>
      {shellProcessClient ? <ConversationBackgroundServices client={shellProcessClient} threadId={currentThread.id} /> : null}
      {collaborationTasks.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <div className="chat-conversation-overview-panel__agents">
            <div className="chat-conversation-overview-panel__agents-title">
              <span>{t('conversation.overview.collaborationTasks')}</span>
              <span aria-label={t(collaborationTasks.length === 1 ? 'conversation.overview.collaborationCount.one' : 'conversation.overview.collaborationCount.many', { count: collaborationTasks.length })}>{collaborationTasks.length}</span>
            </div>
            {collaborationTasks.map((task) => (
              <button
                type="button"
                className="chat-conversation-overview-panel__agent"
                key={task.id}
                disabled={!onOpenSubagent}
                title={task.title || t('conversation.overview.unnamedTask')}
                onClick={() => onOpenSubagent?.(task)}
              >
                <AgentAvatar identity={task.identity} size={20} />
                <strong>{task.identity.displayName}</strong>
                <SubagentTaskStatus status={task.status} />
              </button>
            ))}
          </div>
        </>
      ) : null}
      {overview.planItems.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <ConversationPlanSummary items={overview.planItems} />
        </>
      ) : null}
    </section>
  );
}

function UsageSummaryTooltipContent({
  cacheHitRate,
  callCount,
  totalTokens,
}: {
  cacheHitRate: string;
  callCount: string;
  totalTokens: string;
}) {
  const { t } = useI18n();
  const metrics = [
    {
      label: t('conversation.overview.usageTooltip.totalTokens'),
      value: totalTokens,
    },
    {
      label: t('conversation.overview.usageTooltip.cacheHitRate'),
      value: cacheHitRate,
    },
    {
      label: t('conversation.overview.usageTooltip.callCount'),
      value: callCount,
    },
  ];

  return (
    <div className="chat-conversation-overview-usage-tooltip">
      {metrics.map((metric) => (
        <div className="chat-conversation-overview-usage-tooltip__metric" key={metric.label}>
          <span>{metric.label}</span>
          <span className="chat-conversation-overview-usage-tooltip__value">{metric.value}</span>
        </div>
      ))}
    </div>
  );
}

function formatCacheHitRate(cachedInputTokens: number, inputTokens: number): string {
  if (!Number.isFinite(cachedInputTokens) || !Number.isFinite(inputTokens) || inputTokens <= 0) return '0%';
  const percent = Math.round((cachedInputTokens / inputTokens) * 100);
  return `${Math.min(100, Math.max(0, percent))}%`;
}

function ContextProgressIcon({ percent }: { percent: number }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = Math.min(100, Math.max(0, Number(percent) || 0));
  const dashOffset = circumference * (1 - clampedPercent / 100);
  return (
    <svg className="chat-conversation-overview-progress-icon" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={radius} />
      <circle cx="7" cy="7" r={radius} strokeDasharray={circumference} strokeDashoffset={dashOffset} />
    </svg>
  );
}
