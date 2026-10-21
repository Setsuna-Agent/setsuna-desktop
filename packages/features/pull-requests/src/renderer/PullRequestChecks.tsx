import { Button, DetailSection } from '@setsuna-desktop/renderer-ui';
import { CheckCheck, ExternalLink } from 'lucide-react';
import type { PullRequestDetail } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { CheckState } from './status.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';
import { usePullRequestChecks } from './checks/usePullRequestChecks.js';
import type { PullRequestDetailData } from './reading/session-data.js';

export function PullRequestChecks({ client, detail, revision, data }: { client: PullRequestsClient; detail: PullRequestDetail; revision: number; data: PullRequestDetailData }) {
  const t = usePrText();
  const { Markdown, openExternal } = usePullRequestsHost();
  const { items, pending, loaded, error, retry } = usePullRequestChecks(client, detail, revision, data);
  const { checksCommit } = detail;
  return <section className="pr-checks" aria-label={t('checks')}>
    <header className="pr-checks__heading">
      <h3 className="pr-timeline__heading">{t('checks')}</h3>
      <span className="pr-muted">{t('checksForCommit', { sha: checksCommit?.slice(0, 7) ?? '—' })}</span>
    </header>
    {error ? <div role="alert"><p className="sd-control-error">{error}</p><Button onClick={retry}>{t('retry')}</Button></div> : null}
    {items.map((check) => <DetailSection key={check.id} title={check.name} icon={<CheckCheck size={15} />} count={<CheckState state={check.conclusion ?? check.state} />} defaultExpanded={Boolean(check.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion))}>
      <div className="pr-checks__body">
        <header><span>{check.source} · {check.required ? t('required') : t('optional')}{check.startedAt && check.completedAt ? ` · ${Math.max(0, Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000))}s` : ''}</span>
          {check.url ? <Button size="small" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openExternal(check.url!)}>{t('details')}</Button> : null}
        </header>
        {check.summary ? <div className="pr-markdown"><Markdown content={check.summary} baseUrl={detail.url} /></div> : null}
      </div>
    </DetailSection>)}
    {pending && !loaded ? <PullRequestSkeleton kind="checks" label={t('loading')} /> : null}
    {!pending && !items.length && !error ? <p className="pr-empty">{t('noChecks')}</p> : null}
  </section>;
}
