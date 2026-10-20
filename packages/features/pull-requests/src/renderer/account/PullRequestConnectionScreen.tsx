import { Button } from '@setsuna-desktop/renderer-ui';
import { Github } from 'lucide-react';
import type { PullRequestsClient } from '../client.js';
import type { useConnection } from '../useConnection.js';
import { useCliInstallation } from '../useCliInstallation.js';
import { usePrText } from '../context.js';
import { PullRequestSkeleton } from '../loading/PullRequestSkeleton.js';
import { GitHubCliLoginCommand } from '../GitHubCliLoginCommand.js';

export function PullRequestConnectionScreen({ client, auth }: { client: PullRequestsClient; auth: ReturnType<typeof useConnection> }) {
  const t = usePrText();
  const installation = useCliInstallation(client, auth.refresh);
  const checking = !auth.connection && (!auth.error || auth.pending);
  const needsSetup = auth.connection?.state === 'not-installed' || auth.connection?.state === 'signed-out';
  const installLabel = installation.pending ? installation.state?.phase === 'downloading'
    ? t('cliDownloading', { progress: Math.floor(100 * installation.state.receivedBytes / (installation.state.totalBytes || 1)) })
    : t(installation.state?.phase === 'verifying' ? 'cliVerifying' : installation.state?.phase === 'installing' ? 'cliInstalling' : 'cliPreparing') : t('installCli');
  return <main className="pr-empty pr-welcome">
    {checking ? <PullRequestSkeleton kind="connection" label={t('loading')} /> : <>
      <Github size={36} />
      <h2>{t(needsSetup ? 'connectTitle' : 'connectionCheckFailed')}</h2>
      {needsSetup ? <p>{t(auth.connection?.state === 'not-installed' ? 'cliNotInstalled' : 'connectDescription')}</p> : null}
      {auth.connection?.state === 'signed-out' ? <GitHubCliLoginCommand command={auth.connection.loginCommand} /> : null}
      <div className="pr-welcome__actions">
        {auth.connection?.state === 'not-installed' ? <Button variant="primary" loading={installation.pending} disabled={installation.pending} onClick={() => void installation.start()}>{installLabel}</Button> : null}
        <Button loading={auth.pending} disabled={auth.pending || installation.pending} onClick={() => void auth.refresh()}>{t('checkAgain')}</Button>
      </div>
    </>}
  </main>;
}
