import { Button } from '@setsuna-desktop/renderer-ui';
import type { PullRequestDetail } from '../contracts/index.js';
import { usePrText } from './context.js';
import { CheckState, mergeCondition, PullRequestState } from './status.js';
import { GitHubIdentity } from './GitHubIdentity.js';

export function PullRequestStatus({ detail, onChecks }: { detail: PullRequestDetail; onChecks(): void }) {
  const t = usePrText();
  const condition = mergeCondition(detail, t);
  return <aside className="pr-status" aria-label={t('statusPanel')}>
    <dl className="pr-status__items">
      <div className="pr-status__branch"><dt>{t('branch')}</dt><dd><code title={detail.headBranch}>{detail.headBranch}</code><span>→</span><code title={detail.baseBranch}>{detail.baseBranch}</code><span className="pr-diff-counts"><span>+{detail.additions}</span><span>−{detail.deletions}</span></span></dd></div>
      {detail.reviewers.length ? <div><dt>{t('reviewers')}</dt><dd>{detail.reviewers.map((reviewer) => <GitHubIdentity key={reviewer.name} login={reviewer.name} avatarUrl={reviewer.avatarUrl} showName={detail.reviewers.length === 1} />)}</dd></div> : null}
      <div><dt>{t('checks')}</dt><dd><Button variant="ghost" size="small" onClick={onChecks}><CheckState state={detail.checksState} /></Button></dd></div>
      <div><dt>{t('status')}</dt><dd><PullRequestState pr={detail} /></dd></div>
      {detail.state === 'OPEN' ? <>
        <div><dt>{t('mergeConditions')}</dt><dd className={`pr-merge-condition--${condition.tone}`}>{condition.label}</dd></div>
        {detail.autoMerge ? <div><dt>{t('autoMerge')}</dt><dd>{t('enabled')}</dd></div> : null}
      </> : null}
    </dl>
  </aside>;
}
