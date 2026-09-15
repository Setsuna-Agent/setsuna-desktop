import { useCallback, useEffect, useState } from 'react';
import type { PullRequestDetail, PullRequestReference } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';

export function usePullRequestDetail(client: PullRequestsClient, reference: PullRequestReference) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const { repository, number } = reference;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void client.detail({ repository, number }, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setDetail(value); setError(''); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, repository, number, revision]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 45_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return { detail, error, loading, revision, refresh };
}
