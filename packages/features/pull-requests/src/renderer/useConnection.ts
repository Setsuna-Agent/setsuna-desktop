import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { isAccountChangedError, type PullRequestsClient } from './client.js';
import type { PullRequestConnectionState } from './account/connection-state.js';
import { usePullRequestsHost } from './context.js';

/** Reflect the CLI account; authentication remains owned by gh. */
export function useConnection(client: PullRequestsClient, state: PullRequestConnectionState) {
  const host = usePullRequestsHost();
  const notify = useRef(host.notifyError);
  notify.current = host.notifyError;
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot);
  const refresh = state.refresh;
  // Background avatar checks stay quiet; connection errors belong to the PR page.
  useEffect(() => {
    if (snapshot.error) notify.current(snapshot.error);
  }, [snapshot.error]);
  // All nested comment and merge entry points share the same account refresh path.
  const accountClient = useMemo(() => {
    const guard = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) => async (...args: Args) => {
      try { return await operation(...args); }
      catch (cause) { if (isAccountChangedError(cause)) void refresh(); throw cause; }
    };
    return { ...client, publish: guard(client.publish), act: guard(client.act) };
  }, [client, refresh]);
  return { ...snapshot, refresh, client: accountClient };
}
