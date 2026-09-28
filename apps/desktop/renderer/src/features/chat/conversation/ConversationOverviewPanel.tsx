import { Button } from '@setsuna-desktop/renderer-ui';
import type {
  RuntimeThread,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  CollaborationFeatureTaskList,
  useCollaborationFeatureState,
} from '../../../composition/CollaborationFeatureBoundary.js';
import { RuntimeActivityFeatureConversationServices } from '../../../composition/RuntimeActivityFeatureBoundary.js';
import { UsageFeatureConversationSummary } from '../../../composition/UsageFeatureBoundary.js';
import { localFeatureReviewChangeStats } from '../../../composition/review-feature-adapter.js';
import type { DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { FileDiff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ChangeCountText } from './ChangeCountText.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationPlanSummary } from './ConversationPlanSummary.js';

export function ConversationOverviewPanel({
  activeProject,
  currentThread,
  overview,
  reviewControls,
  reviewState,
  onOpenReview,
  reviewError,
}: {
  activeProject?: WorkspaceProject;
  currentThread: RuntimeThread;
  overview: ConversationOverviewState;
  reviewControls?: ReactNode;
  reviewState: DesktopReviewState | null;
  onOpenReview?: () => void;
  reviewError: string | null;
}) {
  const { t } = useI18n();
  const panelTitle = (currentThread.projectId ? activeProject?.name : undefined) || t('conversation.overview.title');
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

  return (
    <section className="chat-conversation-overview-panel" aria-label={panelTitle}>
      <div className="chat-conversation-overview-panel__header">
        <span title={panelTitle}>{panelTitle}</span>
      </div>
      <div className="chat-conversation-overview-panel__actions">
        <Button variant="ghost"
          type="button"
          className="chat-conversation-overview-panel__row"
          disabled={!onOpenReview}
          onClick={() => onOpenReview?.()}
        >
          <span className="chat-conversation-overview-panel__icon">
            <FileDiff size={14} />
          </span>
          <span className="chat-conversation-overview-panel__label">{t('conversation.overview.review')}</span>
          <span className="chat-conversation-overview-panel__meta" title={reviewFailed ? reviewError ?? undefined : undefined}>
            {hasFileChanges ? (
              <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
            ) : reviewPending ? t('conversation.overview.loading') : reviewFailed ? t('conversation.overview.loadFailed') : t('conversation.overview.noChanges')}
          </span>
        </Button>
        {reviewControls}
        <UsageFeatureConversationSummary thread={currentThread} />
      </div>
      <RuntimeActivityFeatureConversationServices threadId={currentThread.id} />
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
