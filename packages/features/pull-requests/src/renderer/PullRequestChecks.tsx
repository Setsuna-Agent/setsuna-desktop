import { Button, DetailSection } from '@setsuna-desktop/renderer-ui';
import { CheckCheck, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PullRequestCheck, PullRequestDetail } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText, usePrText, usePullRequestsHost } from './context.js';
import { CheckState, Loading } from './status.js';

export function PullRequestChecks({ client, detail, revision }: { client: PullRequestsClient; detail: PullRequestDetail; revision: number }) {
  const t = usePrText();
  const { Markdown, openExternal } = usePullRequestsHost();
  const [items, setItems] = useState<PullRequestCheck[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { repository, number, checksCommit } = detail;
  useEffect(() => {
    const request = new AbortController();
    setPending(true);
    setItems([]);
    setError('');
    void (async () => {
      if (!checksCommit) { setItems([]); setPending(false); return; }
      try {
        let cursor: string | null = null;
        const checks: PullRequestCheck[] = [];
        do {
          const page = await client.checks({ repository, number, commitSha: checksCommit, cursor }, request.signal);
          if (request.signal.aborted) return;
          checks.push(...page.items);
          setItems([...checks]);
          cursor = page.cursor;
        } while (cursor);
      } catch (cause) { if (!request.signal.aborted) setError(errorText(cause)); }
      finally { if (!request.signal.aborted) setPending(false); }
    })();
    return () => request.abort();
  }, [client, repository, number, checksCommit, revision, retry]);
  return <section className="pr-checks" aria-label={t('checks')}>
    <p className="pr-muted">{t('checksForCommit', { sha: checksCommit?.slice(0, 7) ?? '—' })}</p>
    {error ? <div role="alert"><p className="sd-control-error">{error}</p><Button onClick={() => setRetry((value) => value + 1)}>{t('retry')}</Button></div> : null}
    {items.map((check) => <DetailSection key={check.id} title={check.name} icon={<CheckCheck size={15} />} count={<CheckState state={check.conclusion ?? check.state} />} defaultExpanded={Boolean(check.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion))}>
      <div className="pr-checks__body">
        <header><span>{check.source} · {check.required ? t('required') : t('optional')}{check.startedAt && check.completedAt ? ` · ${Math.max(0, Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000))}s` : ''}</span>
          {check.url ? <Button size="small" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openExternal(check.url!)}>{t('details')}</Button> : null}
        </header>
        {check.summary ? <div className="pr-markdown"><Markdown content={check.summary} baseUrl={detail.url} /></div> : null}
      </div>
    </DetailSection>)}
    {pending ? <Loading /> : !items.length && !error ? <p className="pr-empty">{t('noChecks')}</p> : null}
  </section>;
}
