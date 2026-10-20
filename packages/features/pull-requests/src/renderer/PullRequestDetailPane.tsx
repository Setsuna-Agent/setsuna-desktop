import { Button } from '@setsuna-desktop/renderer-ui';
import { useCallback, useRef, useState } from 'react';
import type { PullRequestDetail, PullRequestReference, PullRequestSummary } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { usePullRequestDetail } from './usePullRequestDetail.js';
import { useDiscussions } from './useDiscussions.js';
import { DiscussionTimeline } from './DiscussionTimeline.js';
import type { DiffFocus } from './PullRequestDiff.js';
import { PullRequestDiffDialog } from './PullRequestDiffDialog.js';
import { PullRequestChecks } from './PullRequestChecks.js';
import { MergeActions } from './MergeActions.js';
import { PullRequestBranches, PullRequestMetaMenu } from './PullRequestMetaPanel.js';
import { PullRequestTitle, PullRequestToolbar, PullRequestHeaderActions } from './PullRequestHeader.js';
import { PullRequestDetailLoading } from './PullRequestDetailLoading.js';
import { PullRequestScrollArea } from './PullRequestScrollArea.js';
import type { PullRequestDetailSession } from './session.js';
import { useReadingScroll } from './reading/useReadingScroll.js';

export function PullRequestDetailPane({ client, reference, summary, account, session, onUpdated }: {
  client: PullRequestsClient; reference: PullRequestReference; summary?: PullRequestSummary; account: string; session: PullRequestDetailSession; onUpdated(): void;
}) {
  const request = usePullRequestDetail(client, reference, session.data);
  const t = usePrText();
  const updated = useCallback(() => { void request.refresh(); onUpdated(); }, [request.refresh, onUpdated]);
  return <main className="pr-detail-pane" aria-busy={request.loading}>
    {request.error ? <div className="pr-error" role="alert">{request.error}<Button onClick={() => void request.refresh()}>{t('retry')}</Button></div> : null}
    {!request.detail ? request.loading ? <PullRequestDetailLoading summary={summary} /> : null : <DetailBody client={client} detail={request.detail} account={account} session={session} revision={request.revision} refreshing={request.loading} onUpdated={updated} onRefresh={() => void request.refresh()} />}
  </main>;
}
function DetailBody({ client, detail, account, session, revision, refreshing, onUpdated, onRefresh }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; session: PullRequestDetailSession;
  revision: number; refreshing: boolean; onUpdated(): void; onRefresh(): void;
}) {
  const { openExternal } = usePullRequestsHost();
  const [diff, setDiff] = useState<{ focus: DiffFocus | null } | null>(null);
  const checksRef = useRef<HTMLDivElement>(null);
  const scroll = useReadingScroll(session.scroll, 'detail');
  const discussions = useDiscussions(client, detail, revision, session.data);
  const openDiff = () => setDiff({ focus: null });
  const showChecks = () => {
    scroll.cancelRestore();
    checksRef.current?.scrollIntoView({ block: 'start' });
  };
  return <article className="sd-detail pr-detail">
    <PullRequestToolbar pr={detail} actions={<>
      <PullRequestMetaMenu detail={detail} onChecks={showChecks} onDiff={openDiff} />
      <PullRequestHeaderActions
        changes={detail} onDiff={openDiff} onRefresh={onRefresh} refreshing={refreshing} onOpen={() => void openExternal(detail.url)}
        mergeAction={<MergeActions client={client} detail={detail} account={account} onUpdated={onUpdated} />}
      /></>} />
    <PullRequestScrollArea className="pr-detail__body" contentClassName="pr-detail__main" scrollRef={scroll.scrollRef} onScroll={scroll.onScroll}>
      <PullRequestTitle pr={detail} branches={<PullRequestBranches detail={detail} />} />
      <DiscussionTimeline client={client} detail={detail} account={account} discussions={discussions} revision={revision} data={session.data} onPublished={onUpdated}
        checks={<div ref={checksRef}><PullRequestChecks client={client} detail={detail} revision={revision} data={session.data} /></div>}
        onDiff={(discussion) => setDiff({ focus: { discussion, version: Date.now() } })} />
    </PullRequestScrollArea>
    {diff ? <PullRequestDiffDialog client={client} detail={detail} account={account} discussions={discussions}
      focus={diff.focus} onPublished={onUpdated} session={session} onClose={() => setDiff(null)} /> : null}
  </article>;
}
