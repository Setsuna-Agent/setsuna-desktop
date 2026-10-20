import { GitCommitHorizontal, GitMerge, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft, ListOrdered, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { PullRequestActivityEvent } from '../../contracts/index.js';
import { usePrText, usePullRequestsHost } from '../context.js';
import { Timestamp } from '../status.js';

export function PullRequestActivityRow({ event }: { event: PullRequestActivityEvent }) {
  const t = usePrText();
  const { openExternal } = usePullRequestsHost();
  const Icon = event.kind === 'commit' ? GitCommitHorizontal : event.kind === 'merged' ? GitMerge
    : event.kind === 'closed' ? GitPullRequestClosed : event.kind === 'draft' ? GitPullRequestDraft
      : event.kind === 'reopened' ? RotateCcw : event.kind === 'queued' || event.kind === 'dequeued' ? ListOrdered
        : event.kind.startsWith('auto-') ? Settings2 : GitPullRequestArrow;
  return <div className="pr-activity-row">
    <span className="pr-activity-row__marker" aria-hidden="true"><Icon size={15} /></span>
    <span className="pr-activity-row__label">
      {event.actor ? <strong>{event.actor.login}</strong> : null}
      <span>{t(`activity.${event.kind}`)}</span>
      {event.commit ? <Button size="small" variant="ghost" className="pr-activity-row__commit" title={event.commit.message}
        onClick={() => void openExternal(event.commit!.url)}><code>{event.commit.sha.slice(0, 7)}</code><span>{event.commit.message}</span></Button> : null}
    </span>
    <Timestamp value={event.createdAt} />
  </div>;
}
