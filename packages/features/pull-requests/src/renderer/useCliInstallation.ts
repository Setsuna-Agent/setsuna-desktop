import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubCliInstallation } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText, usePrText, usePullRequestsHost } from './context.js';

const busy = (state: GitHubCliInstallation | null) => !!state && !['idle', 'complete', 'error'].includes(state.phase);

export function useCliInstallation(client: PullRequestsClient, refreshConnection: () => Promise<void>) {
  const [state, setState] = useState<GitHubCliInstallation | null>(null);
  const [starting, setStarting] = useState(false);
  const [revision, setRevision] = useState(0);
  const t = usePrText();
  const host = usePullRequestsHost();
  const callbacks = useRef({ refreshConnection, t, host });
  callbacks.current = { refreshConnection, t, host };
  const previousPhase = useRef<GitHubCliInstallation['phase']>('idle');
  const apply = useCallback((next: GitHubCliInstallation) => {
    setState(next);
    if (next.phase !== previousPhase.current) {
      if (next.phase === 'complete') void callbacks.current.refreshConnection();
      if (next.phase === 'error') callbacks.current.host.notifyError(callbacks.current.t('installFailed', { error: next.error ?? '' }));
    }
    previousPhase.current = next.phase;
  }, []);

  useEffect(() => {
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await client.installation({}, request.signal);
        if (request.signal.aborted) return;
        apply(next);
        if (busy(next)) timer = setTimeout(() => void poll(), 700);
      } catch (error) {
        if (!request.signal.aborted) apply({ phase: 'error', receivedBytes: 0, totalBytes: null, error: errorText(error) });
      }
    };
    void poll();
    return () => { request.abort(); clearTimeout(timer); };
  }, [client, revision, apply]);

  const start = async () => {
    if (starting || busy(state)) return;
    setStarting(true);
    try { apply(await client.install({})); setRevision((value) => value + 1); }
    catch (error) { host.notifyError(t('installFailed', { error: errorText(error) })); }
    finally { setStarting(false); }
  };
  return { state, pending: starting || busy(state), start };
}
