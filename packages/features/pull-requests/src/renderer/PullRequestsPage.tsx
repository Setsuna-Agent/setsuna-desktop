import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { GitPullRequest, Github, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PullRequestReference } from '../contracts/index.js';
import type { PullRequestsRendererHost } from './host.js';
import type { PullRequestsClient } from './client.js';
import { PullRequestsHostContext, usePrText } from './context.js';
import { useConnection } from './useConnection.js';
import { useCliInstallation } from './useCliInstallation.js';
import { usePullRequestList } from './usePullRequestList.js';
import { PullRequestDetailPane } from './PullRequestDetailPane.js';
import { PullRequestFilters } from './PullRequestFilters.js';
import { GitHubIdentity } from './GitHubIdentity.js';
import { GitHubCliLoginCommand } from './GitHubCliLoginCommand.js';
import { PullRequestsSplit } from './PullRequestsSplit.js';
import { CheckState, Loading, PullRequestState, Timestamp } from './status.js';
import type { PullRequestSession } from './session.js';

export function PullRequestsPage({ client, host, session }: { client: PullRequestsClient; host: PullRequestsRendererHost; session: PullRequestSession }) {
  return <PullRequestsHostContext.Provider value={host}><Workbench client={client} session={session} /></PullRequestsHostContext.Provider>;
}
function Workbench({ client, session }: { client: PullRequestsClient; session: PullRequestSession }) {
  const t = usePrText();
  const auth = useConnection(client);
  const installation = useCliInstallation(client, auth.refresh);
  const loginCommand = auth.connection?.loginCommand ?? 'gh auth login --hostname github.com --web';
  const installLabel = installation.pending ? installation.state?.phase === 'downloading'
    ? t('cliDownloading', { progress: Math.floor(100 * installation.state.receivedBytes / (installation.state.totalBytes || 1)) })
    : t(installation.state?.phase === 'verifying' ? 'cliVerifying' : installation.state?.phase === 'installing' ? 'cliInstalling' : 'cliPreparing') : t('installCli');
  const account = auth.connection?.state === 'connected' ? auth.connection.login : null;
  const checkingConnection = !auth.connection && (!auth.error || auth.pending);
  const needsSetup = auth.connection?.state === 'not-installed' || auth.connection?.state === 'signed-out';
  const [repository, setRepository] = useState(session.repository);
  const [filters, setFilters] = useState(session.filters);
  const [selected, setSelected] = useState<PullRequestReference | null>(session.selected);
  const list = usePullRequestList(client, account, repository, filters);
  const scroll = useRef<HTMLDivElement>(null);
  const previousAccount = useRef(account);
  const restoredScroll = useRef(false);
  const select = (reference: PullRequestReference | null) => { setSelected(reference); session.selected = reference; };
  useEffect(() => {
    if (previousAccount.current && previousAccount.current !== account) { setSelected(null); session.selected = null; }
    previousAccount.current = account;
  }, [account, session]);
  useEffect(() => {
    if (list.items.length && !restoredScroll.current && scroll.current) { restoredScroll.current = true; scroll.current.scrollTop = session.listScroll; }
  }, [list.items, session]);
  return <PullRequestsSplit session={session} sidebar={account ?
    <aside className="pr-sidebar">
      <header className="pr-sidebar__header">
        <h1><GitPullRequest size={18} />Pull Request</h1>
        <IconButton size="small" label={t('refresh')} disabled={list.loading} onClick={() => { list.refresh(); void auth.refresh(); }}><RefreshCw size={14} /></IconButton>
        <GitHubIdentity login={account} avatarUrl={auth.connection?.avatarUrl ?? null} showName={false} />
      </header>
      <PullRequestFilters value={{ repository, filters }} repositories={list.inventory.repositories} authors={list.items.map((item) => item.author.login)} onChange={(next) => {
        setRepository(next.repository); setFilters(next.filters);
        session.repository = next.repository; session.filters = next.filters; select(null);
      }} />
      <div className="pr-list" ref={scroll} onScroll={(event) => { session.listScroll = event.currentTarget.scrollTop; }} aria-label={t('pullRequests')}>
        {list.error ? <p className="sd-control-error" role="alert">{list.error}</p> : null}
        {list.inventory.issues.map((issue) => <p className="pr-notice" key={issue.project}>{issue.project}: {issue.message}</p>)}
        {list.errors.map((issue) => <p className="sd-control-error" role="alert" key={issue.repository}>{issue.repository}: {issue.message}</p>)}
        {list.items.map((pr) => <Button key={pr.id} variant="ghost" className={`pr-list-item${selected?.repository === pr.repository && selected.number === pr.number ? ' is-selected' : ''}`} aria-current={selected?.repository === pr.repository && selected.number === pr.number ? 'true' : undefined} onClick={() => select({ repository: pr.repository, number: pr.number })}>
          <span className="pr-list-item__meta"><PullRequestState pr={pr} label={false} /><span>#{pr.number}</span><Timestamp value={pr.updatedAt} /><CheckState state={pr.checksState} label={false} /></span>
          <strong title={pr.title}>{pr.title}</strong>
          <span className="pr-list-item__footer"><GitHubIdentity login={pr.author.login} avatarUrl={pr.author.avatarUrl} /><span className="pr-list-item__repository" title={pr.repository}>{pr.repository}</span></span>
        </Button>)}
        {list.loading ? <Loading /> : account && !list.items.length ? <p className="pr-empty">{list.inventory.repositories.length ? t('noResults') : t('noRepositories')}</p> : null}
        {list.hasMore ? <Button disabled={list.loading} onClick={() => void list.more()}>{t('loadMore')}</Button> : null}
      </div>
    </aside> : null
    }>
    {account ? selected ? <PullRequestDetailPane key={`${account}/${selected.repository}/${selected.number}`} client={auth.client} reference={selected} summary={list.items.find((item) => item.repository === selected.repository && item.number === selected.number)} account={account} session={session} onUpdated={list.refresh} /> : <div className="pr-empty pr-welcome"><GitPullRequest size={32} /><h2>{t('selectPr')}</h2><p>{t('selectPrDescription')}</p></div>
      : <main className="pr-empty pr-welcome">
        {checkingConnection ? <Loading /> : <>
          <Github size={36} />
          <h2>{t(needsSetup ? 'connectTitle' : 'connectionCheckFailed')}</h2>
          {needsSetup ? <p>{t(auth.connection?.state === 'not-installed' ? 'cliNotInstalled' : 'connectDescription')}</p> : null}
          {auth.connection?.state === 'signed-out' ? <GitHubCliLoginCommand command={loginCommand} /> : null}
          <div className="pr-welcome__actions">
            {auth.connection?.state === 'not-installed' ? <Button variant="primary" loading={installation.pending} disabled={installation.pending} onClick={() => void installation.start()}>{installLabel}</Button> : null}
            <Button loading={auth.pending} disabled={auth.pending || installation.pending} onClick={() => void auth.refresh()}>{t('checkAgain')}</Button>
          </div>
        </>}
      </main>}
  </PullRequestsSplit>;
}
