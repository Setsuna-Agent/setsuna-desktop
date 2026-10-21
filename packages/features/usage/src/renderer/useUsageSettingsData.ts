import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeUsageQuery, UsageRendererStateService, UsageSnapshot } from '../contracts/index.js';

/** The baseline snapshot stays visible while refreshing; filtered queries cannot replace it. */
export function useUsageSettingsData(service: UsageRendererStateService) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    setError(null);
    const isCurrent = () => pending.current === request && !request.signal.aborted;
    void service.query({}, { signal: request.signal }).then((next) => {
      if (isCurrent()) setSnapshot(next);
    }).catch((loadError: unknown) => {
      if (isCurrent()) setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (isCurrent()) {
        pending.current = null;
        setLoading(false);
      }
    });
  }, [service]);

  useEffect(() => {
    const unsubscribe = service.subscribeInvalidation(refresh);
    refresh();
    return () => {
      unsubscribe();
      pending.current?.abort();
      pending.current = null;
    };
  }, [refresh, service]);

  const query = useCallback(async (input: RuntimeUsageQuery) => (
    await service.query(input)
  ).usage, [service]);

  return { snapshot, loading, error, refresh, query };
}
