import type { ReactNode } from 'react';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ExternalLink, GitMerge, RefreshCw } from 'lucide-react';
import type { PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';
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

export function PullRequestHeaderActions({ onRefresh, onOpen, mergeAction }: {
  onRefresh?(): void; onOpen?(): void; mergeAction?: ReactNode;
}) {
  const t = usePrText();
  return <>
    <IconButton label={t('refresh')} size="small" disabled={!onRefresh} onClick={onRefresh}><RefreshCw size={14} /></IconButton>
    <IconButton label={t('openGitHub')} size="small" disabled={!onOpen} onClick={onOpen}><ExternalLink size={14} /></IconButton>
    {mergeAction ?? <Button size="small" icon={<GitMerge size={14} />} disabled>{t('merge')}<ChevronDown size={13} /></Button>}
  </>;
}
