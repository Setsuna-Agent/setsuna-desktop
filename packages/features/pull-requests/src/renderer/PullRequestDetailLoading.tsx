import { Skeleton } from '@setsuna-desktop/renderer-ui';
import type { PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { PullRequestHeader, PullRequestHeaderActions } from './PullRequestHeader.js';
import { PullRequestTabs } from './PullRequestTabs.js';
import { PullRequestScrollArea } from './PullRequestScrollArea.js';
import type { PullRequestTab } from './session.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';

export function PullRequestDetailLoading({ summary, tab }: { summary?: PullRequestSummary; tab: PullRequestTab }) {
  const t = usePrText();
  const { PageHeader } = usePullRequestsHost();
  const actions = <PullRequestHeaderActions />;
  return <article className="sd-detail pr-detail pr-detail-loading" role="status" aria-label={t('loading')}>
    {summary ? <PullRequestHeader pr={summary} actions={actions} /> : <>
      <div className="pr-detail__topline"><Skeleton className="pr-detail-loading__eyebrow" /><div className="sd-page-header__actions pr-detail__toolbar">{actions}</div></div>
      <PageHeader className="sd-detail__header" title={<Skeleton className="pr-detail-loading__title" />} subtitle={<Skeleton className="pr-detail-loading__author" />} />
    </>}
    <div className="pr-status pr-detail-loading__status"><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
    <PullRequestTabs tab={tab} />
    <PullRequestScrollArea className="pr-detail__body" contentClassName="pr-detail__main" scrollable={tab !== 'diff'}>
      {tab === 'diff' ? <div className="pr-detail__panel--diff">
        <div className="pr-diff">
          <div className="pr-diff__navigation pr-detail-loading__files"><PullRequestSkeleton kind="files" /></div>
          <div className="pr-diff__content pr-detail-loading__patch"><PullRequestSkeleton kind="patch" /></div>
        </div>
      </div> : tab === 'checks' ? <PullRequestSkeleton kind="checks" /> : <div className="pr-detail__panel--overview">
        <PullRequestSkeleton kind="paragraphs" />
        <div className="pr-timeline"><Skeleton className="pr-composer pr-detail-loading__composer" /></div>
      </div>}
    </PullRequestScrollArea>
  </article>;
}
