import type { ReactNode } from 'react';
import type { PullRequestSummary } from '../contracts/index.js';
import { usePullRequestsHost } from './context.js';
import { GitHubIdentity } from './GitHubIdentity.js';
import { PullRequestState, Timestamp } from './status.js';

/** List metadata can render the same header before the full detail arrives. */
export function PullRequestHeader({ pr, actions }: { pr: PullRequestSummary; actions: ReactNode }) {
  const { PageHeader } = usePullRequestsHost();
  return <>
    <div className="pr-detail__topline">
      <div className="pr-detail__eyebrow"><PullRequestState pr={pr} /><span title={`${pr.repository} #${pr.number}`}>{pr.repository} #{pr.number}</span></div>
      <div className="sd-page-header__actions pr-detail__toolbar">{actions}</div>
    </div>
    <PageHeader className="sd-detail__header" title={pr.title} subtitle={<span className="pr-detail__metadata"><GitHubIdentity login={pr.author.login} avatarUrl={pr.author.avatarUrl} /><span>·</span><Timestamp value={pr.updatedAt} /></span>} />
  </>;
}
