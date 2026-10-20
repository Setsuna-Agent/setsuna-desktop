import { Skeleton } from '@setsuna-desktop/renderer-ui';
import type { PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { PullRequestTitle, PullRequestToolbar, PullRequestHeaderActions } from './PullRequestHeader.js';
import { PullRequestScrollArea } from './PullRequestScrollArea.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';

export function PullRequestDetailLoading({ summary }: { summary?: PullRequestSummary }) {
  const t = usePrText();
  const { PageHeader } = usePullRequestsHost();
  const actions = <PullRequestHeaderActions />;
  return <article className="sd-detail pr-detail pr-detail-loading" role="status" aria-label={t('loading')}>
    {summary ? <PullRequestToolbar pr={summary} actions={actions} />
      : <div className="pr-detail__topline"><Skeleton className="pr-detail-loading__eyebrow" /><div className="sd-page-header__actions pr-detail__toolbar">{actions}</div></div>}
    <PullRequestScrollArea className="pr-detail__body" contentClassName="pr-detail__main">
      {summary ? <PullRequestTitle pr={summary} />
        : <PageHeader className="sd-detail__header" title={<Skeleton className="pr-detail-loading__title" />} subtitle={<Skeleton className="pr-detail-loading__author" />} />}
      <div className="pr-timeline">
        <ol className="pr-timeline__stack">
          <li className="pr-timeline__entry"><div className="pr-card"><PullRequestSkeleton kind="discussion" /></div></li>
          <li className="pr-timeline__entry"><div className="pr-card"><PullRequestSkeleton kind="discussion" /></div></li>
        </ol>
        <PullRequestSkeleton kind="checks" />
        <Skeleton className="pr-composer pr-detail-loading__composer" />
      </div>
    </PullRequestScrollArea>
  </article>;
}
