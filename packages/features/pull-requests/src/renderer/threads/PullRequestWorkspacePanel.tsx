import { useSyncExternalStore, useCallback } from 'react';
import type { PullRequestReference, ThreadPullRequestsStateService } from '../../contracts/index.js';
import { pullRequestKey } from '../../contracts/index.js';
import type { PullRequestsRendererHost } from '../host.js';
import type { PullRequestsClient } from '../client.js';
import type { PullRequestConnectionState } from '../account/connection-state.js';
import { PullRequestsHostContext } from '../context.js';
import { useConnection } from '../useConnection.js';
import { getPullRequestDetailSession, type PullRequestSession } from '../session.js';
import { PullRequestDetailPane } from '../PullRequestDetailPane.js';
import { PullRequestConnectionScreen } from '../account/PullRequestConnectionScreen.js';

type Props = {
  client: PullRequestsClient; connectionState: PullRequestConnectionState; host: PullRequestsRendererHost;
  reference: PullRequestReference; threadId: string; state: ThreadPullRequestsStateService;
  session: PullRequestSession;
};
export function PullRequestWorkspacePanel(props: Props) {
  return <PullRequestsHostContext.Provider value={props.host}><Panel {...props} /></PullRequestsHostContext.Provider>;
}
function Panel({ client, connectionState, reference, threadId, state, session }: Props) {
  const auth = useConnection(client, connectionState);
  const subscribe = useCallback((listener: () => void) => state.subscribe(threadId, listener), [state, threadId]);
  const snapshot = useCallback(() => state.getSnapshot(threadId), [state, threadId]);
  const items = useSyncExternalStore(subscribe, snapshot);
  const summary = items.find((item) => pullRequestKey(item.attachment) === pullRequestKey(reference))?.summary ?? undefined;
  const account = auth.connection?.state === 'connected' ? auth.connection.login : null;
  return <div className="pr-workspace-detail">{account
    ? <PullRequestDetailPane key={`${account}/${pullRequestKey(reference)}`} client={auth.client} reference={reference}
      summary={summary} account={account} session={getPullRequestDetailSession(session, account, reference, threadId)} onUpdated={state.refresh} />
    : <PullRequestConnectionScreen client={client} auth={auth} />}</div>;
}
