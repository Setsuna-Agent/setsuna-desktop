import type {
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeUsageResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChevronsRightLeft, CircleGauge, FileText } from 'lucide-react';
import type { DesktopReviewLoadOptions, DesktopReviewState } from '../../workspace/model.js';
import { localReviewChangeStats } from '../../workspace/reviewChanges.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { ChangeCountText } from './ChangeCountText.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationBackgroundServices, type BackgroundShellProcessClient } from './ConversationBackgroundServices.js';
import { ConversationGitControls } from './ConversationGitControls.js';
import { ConversationPlanSummary } from './ConversationPlanSummary.js';

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
  threads,
  onCollapse,
  onExpand,
  onOpenReview,
  onOpenThread,
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
  threads: RuntimeThreadSummary[];
  onCollapse: () => void;
  onExpand: () => void;
  onOpenReview?: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onReviewRefresh?: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
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
  const latestTurn = currentThread.turns?.at(-1);
  // Forks are independent conversations; only derived sub-agents are collaboration tasks.
  const childThreads = threads.filter((thread) => thread.parentThreadId === currentThread.id);
  const diagnosticLabel = turnDiagnosticLabel(latestTurn, t);
  const callCount = usageSummary?.recordCount ?? 0;
  const usageDiagnosticLabel = `${formatUsageTokens(usageSummary?.totalTokens ?? 0)} · ${t(callCount === 1 ? 'conversation.overview.callCount.one' : 'conversation.overview.callCount.many', { count: callCount })} · ${diagnosticLabel}`;

  if (compact) {
    return (
      <button className="chat-conversation-overview-chip" type="button" aria-label={t('conversation.overview.expand')} onClick={onExpand}>
        <FileText size={13} />
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
          <ChevronsRightLeft size={13} />
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
            <FileText size={14} />
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
          <span className="chat-conversation-overview-panel__meta" title={usageDiagnosticLabel}>{usageDiagnosticLabel}</span>
        </div>
      </div>
      {shellProcessClient ? <ConversationBackgroundServices client={shellProcessClient} threadId={currentThread.id} /> : null}
      {childThreads.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <div className="chat-conversation-overview-panel__agents">
            <div className="chat-conversation-overview-panel__agents-title">
              <span>{t('conversation.overview.collaborationTasks')}</span>
              <span aria-label={t(childThreads.length === 1 ? 'conversation.overview.collaborationCount.one' : 'conversation.overview.collaborationCount.many', { count: childThreads.length })}>{childThreads.length}</span>
            </div>
            {childThreads.map((thread) => (
              <button type="button" key={thread.id} onClick={() => void onOpenThread(thread.id)}>
                <span className={thread.activeTurnId ? 'is-running' : undefined} aria-hidden="true" />
                <strong title={thread.title}>{thread.title || t('conversation.overview.unnamedTask')}</strong>
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

function formatUsageTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function turnDiagnosticLabel(turn: NonNullable<RuntimeThread['turns']>[number] | undefined, t: Translate): string {
  if (!turn) return t('conversation.overview.diagnostic.none');
  const status = turn.status === 'in_progress'
    ? t('conversation.overview.diagnostic.running')
    : turn.status === 'completed'
      ? t('conversation.overview.diagnostic.completed')
      : turn.status === 'failed'
        ? t('conversation.overview.diagnostic.failed')
        : turn.status === 'cancelled'
          ? t('conversation.overview.diagnostic.cancelled')
          : t('conversation.overview.diagnostic.unknown');
  const signals = [
    turn.modelVerifications?.length
      ? t(turn.modelVerifications.length === 1
        ? 'conversation.overview.diagnostic.verifications.one'
        : 'conversation.overview.diagnostic.verifications.many', { count: turn.modelVerifications.length })
      : null,
    turn.safetyBuffering ? t('conversation.overview.diagnostic.safetyBuffer') : null,
  ].filter(Boolean);
  return signals.length ? `${status} · ${signals.join(' · ')}` : status;
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
