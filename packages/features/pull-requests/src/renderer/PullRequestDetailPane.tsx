import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestDetail, PullRequestReference, PullRequestSummary } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { usePullRequestDetail } from './usePullRequestDetail.js';
import { useDiscussions } from './useDiscussions.js';
import { DiscussionTimeline } from './DiscussionTimeline.js';
import { PullRequestDiff, type DiffFocus } from './PullRequestDiff.js';
import { PullRequestChecks } from './PullRequestChecks.js';
import { MergeActions } from './MergeActions.js';
import { PullRequestStatus } from './PullRequestStatus.js';
import { PullRequestHeader } from './PullRequestHeader.js';
import { PullRequestDetailLoading } from './PullRequestDetailLoading.js';
import type { PullRequestSession, PullRequestTab } from './session.js';

export function PullRequestDetailPane({ client, reference, summary, account, session, onUpdated }: {
  client: PullRequestsClient; reference: PullRequestReference; summary?: PullRequestSummary; account: string; session: PullRequestSession; onUpdated(): void;
}) {
  const request = usePullRequestDetail(client, reference);
  const t = usePrText();
  const updated = useCallback(() => { request.refresh(); onUpdated(); }, [request.refresh, onUpdated]);
  return <main className="pr-detail-pane" aria-busy={request.loading}>
    {request.error ? <div className="pr-error" role="alert">{request.error}<Button onClick={request.refresh}>{t('retry')}</Button></div> : null}
    {!request.detail ? request.loading ? <PullRequestDetailLoading summary={summary} tab={session.tab} /> : null : <DetailBody client={client} detail={request.detail} account={account} session={session} revision={request.revision} onUpdated={updated} onRefresh={request.refresh} />}
  </main>;
}
function DetailBody({ client, detail, account, session, revision, onUpdated, onRefresh }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; session: PullRequestSession;
  revision: number; onUpdated(): void; onRefresh(): void;
}) {
  const t = usePrText();
  const { Markdown, openExternal } = usePullRequestsHost();
  const [tab, setTab] = useState(session.tab);
  const [visited, setVisited] = useState(() => new Set<PullRequestTab>(['overview', session.tab]));
  const [focus, setFocus] = useState<DiffFocus | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const discussions = useDiscussions(client, detail, revision);
  const scrollKey = `${detail.repository}:${detail.number}:${tab}`;
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = session.detailScroll.get(scrollKey) ?? 0; }, [session, scrollKey]);
  const selectTab = (value: PullRequestTab) => { setTab(value); session.tab = value; setVisited((current) => new Set([...current, value])); };
  return <article className="sd-detail pr-detail">
    <PullRequestHeader pr={detail} actions={<>
      <IconButton label={t('refresh')} size="small" onClick={onRefresh}><RefreshCw size={14} /></IconButton>
      <IconButton label={t('openGitHub')} size="small" onClick={() => void openExternal(detail.url)}><ExternalLink size={14} /></IconButton>
      <MergeActions client={client} detail={detail} account={account} onUpdated={onUpdated} />
    </>} />
    <PullRequestStatus detail={detail} onChecks={() => selectTab('checks')} />
    <div className="pr-tabs" role="tablist" aria-label={t('pullRequest')}>
      {(['overview', 'diff', 'checks'] as const).map((value) => <Button id={`pr-tab-${value}`} key={value} role="tab" aria-selected={tab === value} aria-controls={`pr-panel-${value}`} variant="ghost" onClick={() => selectTab(value)}>
        {t(value)}
        {value === 'diff' ? <small>{detail.fileCount}</small> : null}
        {value === 'checks' && detail.checksProgress ? <small title={t('checksProgress', detail.checksProgress)}>{detail.checksProgress.passed}/{detail.checksProgress.total}</small> : null}
      </Button>)}
    </div>
    <div className={`pr-detail__body${tab === 'diff' ? ' pr-detail__body--diff' : ''}`} ref={scroll} onScroll={(event) => session.detailScroll.set(scrollKey, event.currentTarget.scrollTop)}>
      <div className="pr-detail__main">
        <section id="pr-panel-overview" className="pr-detail__panel--overview" role="tabpanel" aria-labelledby="pr-tab-overview" hidden={tab !== 'overview'}>
          <div className="pr-markdown pr-description" aria-label={t('description')}><Markdown content={detail.body || t('noDescription')} baseUrl={`https://github.com/${detail.headRepository ?? detail.repository}/blob/${detail.headSha}/`} /></div>
          <DiscussionTimeline client={client} detail={detail} account={account} discussions={discussions} onPublished={onUpdated} onDiff={(discussion) => { setFocus({ discussion, version: Date.now() }); selectTab('diff'); }} />
        </section>
        <section id="pr-panel-diff" className="pr-detail__panel--diff" role="tabpanel" aria-labelledby="pr-tab-diff" hidden={tab !== 'diff'}>{visited.has('diff') ? <PullRequestDiff client={client} detail={detail} account={account} discussions={discussions} focus={focus} onPublished={onUpdated} /> : null}</section>
        <section id="pr-panel-checks" role="tabpanel" aria-labelledby="pr-tab-checks" hidden={tab !== 'checks'}>{visited.has('checks') ? <PullRequestChecks client={client} detail={detail} revision={revision} /> : null}</section>
      </div>
    </div>
  </article>;
}
