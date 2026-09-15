import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestConnection } from '../contracts/index.js';
import { isAccountChangedError, type PullRequestsClient } from './client.js';
import { errorText, usePullRequestsHost } from './context.js';

/** Reflect the CLI account; authentication remains owned by gh. */
export function useConnection(client: PullRequestsClient) {
  const host = usePullRequestsHost();
  const notify = useRef(host.notifyError);
  notify.current = host.notifyError;
  const [connection, setConnection] = useState<PullRequestConnection | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    try {
      const value = await client.connection({}, request.signal);
      if (!request.signal.aborted) { setConnection(value); setError(''); if (value.error) notify.current(value.error); }
    } catch (cause) { if (!request.signal.aborted) { setError(errorText(cause)); notify.current(errorText(cause)); } }
    finally { if (!request.signal.aborted) setPending(false); }
  }, [client]);
  // All nested comment and merge entry points share the same account refresh path.
  const accountClient = useMemo(() => {
    const guard = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) => async (...args: Args) => {
      try { return await operation(...args); }
      catch (cause) { if (isAccountChangedError(cause)) void refresh(); throw cause; }
    };
    return { ...client, publish: guard(client.publish), act: guard(client.act) };
  }, [client, refresh]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { controller.current?.abort(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  return { connection, error, pending, refresh, client: accountClient };
}
