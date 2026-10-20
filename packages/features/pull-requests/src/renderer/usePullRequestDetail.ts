import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestDetail, PullRequestReference } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';

export function usePullRequestDetail(client: PullRequestsClient, reference: PullRequestReference) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const current = useRef<AbortController | null>(null);
  const { repository, number } = reference;
  const load = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setLoading(true);
    setError('');
    try {
      const value = await client.detail({ repository, number }, controller.signal);
      if (controller.signal.aborted) return false;
      setDetail(value);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
      return false;
    } finally {
      if (!controller.signal.aborted) {
        current.current = null;
        setLoading(false);
      }
    }
  }, [client, repository, number]);
  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    return load();
  }, [load]);
  useEffect(() => {
    void load();
    return () => current.current?.abort();
  }, [load]);
  useEffect(() => {
    // Background updates must not cancel a manual refresh before its result can be reported.
    const refreshWhenIdle = () => { if (!current.current) void refresh(); };
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshWhenIdle(); }, 45_000);
    window.addEventListener('focus', refreshWhenIdle);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshWhenIdle); };
  }, [refresh]);
  return { detail, error, loading, revision, refresh };
}
