import { Skeleton } from '@setsuna-desktop/renderer-ui';
import type { PullRequestSummary } from '../contracts/index.js';
import { usePrText } from './context.js';
import { PullRequestHeader } from './PullRequestHeader.js';
import type { PullRequestTab } from './session.js';

export function PullRequestDetailLoading({ summary, tab }: { summary?: PullRequestSummary; tab: PullRequestTab }) {
  const t = usePrText();
  const actions = <Skeleton className="pr-detail-loading__actions" />;
  return <article className="sd-detail pr-detail pr-detail-loading" role="status" aria-label={t('loading')}>
    {summary ? <PullRequestHeader pr={summary} actions={actions} /> : <>
      <div className="pr-detail__topline"><Skeleton className="pr-detail-loading__eyebrow" />{actions}</div>
      <div className="sd-detail__header pr-detail-loading__header"><Skeleton className="pr-detail-loading__title" /><Skeleton className="pr-detail-loading__author" /></div>
    </>}
    <div className="pr-status pr-detail-loading__status"><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
    <div className="pr-tabs pr-detail-loading__tabs"><Skeleton /><Skeleton /><Skeleton /></div>
    <div className="pr-detail__body">
      {tab === 'diff' ? <div className="pr-detail-loading__diff">
        <div className="pr-detail-loading__files"><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
        <LoadingParagraphs />
      </div> : tab === 'checks' ? <div className="pr-detail-loading__checks"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div> : <LoadingParagraphs />}
    </div>
  </article>;
}

function LoadingParagraphs() {
  return <div className="pr-detail-loading__paragraphs" aria-hidden="true">
    {[0, 1, 2].map((paragraph) => <div key={paragraph}><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}
  </div>;
}
