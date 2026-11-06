import type { ReactNode } from 'react';
import { Button, IconButton, Skeleton } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ExternalLink, FileDiff, GitMerge, RefreshCw } from 'lucide-react';
import type { PullRequestDetail, PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { PullRequestState, Timestamp } from './status.js';

export function PullRequestToolbar({ pr, actions }: { pr?: PullRequestSummary; actions: ReactNode }) {
  return <header className="pr-detail__topline sd-panel-toolbar">
    <div className="pr-detail__eyebrow sd-panel-toolbar__surface">
      {pr ? <><PullRequestState pr={pr} /><span title={pr.repository}>{pr.repository} #{pr.number}</span></>
        : <Skeleton className="pr-detail-loading__eyebrow" />}
    </div>
    <div className="pr-detail__toolbar sd-panel-toolbar__actions">{actions}</div>
  </header>;
}

export function PullRequestTitle({ pr, branches }: { pr: PullRequestSummary; branches?: ReactNode }) {
  const { PageHeader } = usePullRequestsHost();
  return <PageHeader className="sd-detail__header" title={pr.title} subtitle={<span className="pr-detail__byline">
      <span className="pr-detail__metadata">
        <Timestamp value={pr.updatedAt} />
      </span>
      {branches}
    </span>} />;
}

export function PullRequestHeaderActions({ changes, onDiff, onRefresh, refreshing = false, onOpen, metaAction, mergeAction }: {
  changes?: Pick<PullRequestDetail, 'additions' | 'deletions'>;
  onDiff?(): void; onRefresh?(): void; refreshing?: boolean; onOpen?(): void; metaAction?: ReactNode; mergeAction?: ReactNode;
}) {
  const t = usePrText();
  return <>
    <div className="sd-panel-toolbar__surface">
      {metaAction}
      <Button variant="ghost" size="small" className="pr-detail__diff-action sd-panel-toolbar__text-button" icon={<FileDiff size={14} />}
        aria-label={t('viewDiff')} title={t('viewDiff')} disabled={!onDiff} onClick={onDiff}>
        {changes ? <span className="pr-diff-counts"><span>+{changes.additions}</span><span>−{changes.deletions}</span></span> : null}
      </Button>
      <IconButton className="app-shell-icon-control" label={t(refreshing ? 'refreshing' : 'refresh')} size="small" loading={refreshing} disabled={!onRefresh} onClick={onRefresh}>
        {refreshing ? null : <RefreshCw size={14} />}
      </IconButton>
      <IconButton className="app-shell-icon-control" label={t('openGitHub')} size="small" disabled={!onOpen} onClick={onOpen}><ExternalLink size={14} /></IconButton>
    </div>
    {mergeAction ?? <div className="pr-merge-actions" role="group" aria-label={t('merge')}>
      <Button variant="primary" size="small" icon={<GitMerge size={14} aria-hidden="true" />} disabled>{t('merge')}</Button>
      <Button variant="primary" size="small" aria-label={t('mergeMethod')} disabled><ChevronDown size={13} aria-hidden="true" /></Button>
    </div>}
  </>;
}
