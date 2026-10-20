import type { ReactNode } from 'react';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ExternalLink, FileDiff, GitMerge, RefreshCw } from 'lucide-react';
import type { PullRequestDetail, PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { GitHubIdentity } from './GitHubIdentity.js';
import { PullRequestState, Timestamp } from './status.js';

export function PullRequestToolbar({ pr, actions }: { pr: PullRequestSummary; actions: ReactNode }) {
  return <div className="pr-detail__topline">
    <div className="pr-detail__eyebrow"><PullRequestState pr={pr} /><span title={pr.repository}>{pr.repository} #{pr.number}</span></div>
    <div className="sd-page-header__actions pr-detail__toolbar">{actions}</div>
  </div>;
}

export function PullRequestTitle({ pr, branches }: { pr: PullRequestSummary; branches?: ReactNode }) {
  const { PageHeader } = usePullRequestsHost();
  return <PageHeader className="sd-detail__header" title={pr.title} subtitle={<span className="pr-detail__byline">
      <span className="pr-detail__metadata">
        <GitHubIdentity login={pr.author.login} avatarUrl={pr.author.avatarUrl} />
        <span aria-hidden="true">·</span><Timestamp value={pr.updatedAt} />
      </span>
      {branches}
    </span>} />;
}

export function PullRequestHeaderActions({ changes, onDiff, onRefresh, refreshing = false, onOpen, mergeAction }: {
  changes?: Pick<PullRequestDetail, 'additions' | 'deletions'>;
  onDiff?(): void; onRefresh?(): void; refreshing?: boolean; onOpen?(): void; mergeAction?: ReactNode;
}) {
  const t = usePrText();
  return <>
    <Button variant="ghost" size="small" className="pr-detail__diff-action" icon={<FileDiff size={14} />}
      aria-label={t('viewDiff')} title={t('viewDiff')} disabled={!onDiff} onClick={onDiff}>
      {changes ? <span className="pr-diff-counts"><span>+{changes.additions}</span><span>−{changes.deletions}</span></span> : null}
    </Button>
    <IconButton label={t(refreshing ? 'refreshing' : 'refresh')} size="small" loading={refreshing} disabled={!onRefresh} onClick={onRefresh}>
      {refreshing ? null : <RefreshCw size={14} />}
    </IconButton>
    <IconButton label={t('openGitHub')} size="small" disabled={!onOpen} onClick={onOpen}><ExternalLink size={14} /></IconButton>
    {mergeAction ?? <div className="pr-merge-actions" role="group" aria-label={t('merge')}>
      <Button variant="primary" size="small" icon={<GitMerge size={14} aria-hidden="true" />} disabled>{t('merge')}</Button>
      <Button variant="primary" size="small" aria-label={t('mergeMethod')} disabled><ChevronDown size={13} aria-hidden="true" /></Button>
    </div>}
  </>;
}
