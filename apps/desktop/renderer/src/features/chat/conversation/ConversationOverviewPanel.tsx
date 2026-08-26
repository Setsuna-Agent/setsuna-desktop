import type {
  RuntimeThread,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  CollaborationFeatureTaskList,
  useCollaborationFeatureState,
} from '../../../composition/CollaborationFeatureBoundary.js';
import { UsageFeatureConversationSummary } from '../../../composition/UsageFeatureBoundary.js';
import { localFeatureReviewChangeStats } from '../../../composition/review-feature-adapter.js';
import type { DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { ChevronUp, FileDiff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ChangeCountText } from './ChangeCountText.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationBackgroundServices, type BackgroundShellProcessClient } from './ConversationBackgroundServices.js';
import { ConversationPlanSummary } from './ConversationPlanSummary.js';

export function ConversationOverviewPanel({
  activeProject,
  compact,
  contextLabel,
  contextPercent,
  currentThread,
  overview,
  reviewControls,
  shellProcessClient,
  reviewState,
  onCollapse,
  onExpand,
  onOpenReview,
  reviewError,
}: {
  activeProject?: WorkspaceProject;
  compact: boolean;
  contextLabel: string;
  contextPercent: number;
  currentThread: RuntimeThread;
  overview: ConversationOverviewState;
  reviewControls?: ReactNode;
  shellProcessClient?: BackgroundShellProcessClient;
  reviewState: DesktopReviewState | null;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenReview?: () => void;
  reviewError: string | null;
}) {
  const { t } = useI18n();
  const changeStats = reviewState?.isGitRepository
    ? localFeatureReviewChangeStats(reviewState)
    : {
        additions: overview.fileChangeSummary?.additions ?? 0,
        deletions: overview.fileChangeSummary?.deletions ?? 0,
        fileCount: overview.fileChangeSummary?.files.length ?? 0,
      };
  const hasFileChanges = changeStats.fileCount > 0;
  // The first status read is pending before the review state effect settles.
  const reviewPending = Boolean(activeProject && !reviewState && !reviewError);
  const reviewFailed = Boolean(activeProject && !reviewState && reviewError);
  const collaboration = useCollaborationFeatureState(currentThread.id);

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
        {reviewControls}
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon">
            <ContextProgressIcon percent={contextPercent} />
          </span>
          <span className="chat-conversation-overview-panel__label">{t('conversation.overview.context')}</span>
          <span className="chat-conversation-overview-panel__meta">{contextLabel}</span>
        </div>
        <UsageFeatureConversationSummary thread={currentThread} />
      </div>
      {shellProcessClient ? <ConversationBackgroundServices client={shellProcessClient} threadId={currentThread.id} /> : null}
      <CollaborationFeatureTaskList
        parentThreadId={currentThread.id}
        tasks={collaboration.state.tasks}
        translate={t}
      />
      {overview.planItems.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <ConversationPlanSummary items={overview.planItems} />
        </>
      ) : null}
    </section>
  );
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
