import type {
  DesktopRuntimeClient,
  RuntimeActiveTask,
  RuntimeActivityList,
  RuntimeBackgroundServiceActivity,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';

const RUNTIME_ACTIVITY_POLL_INTERVAL_MS = 2_000;

export type RuntimeActivityClient = Pick<
  DesktopRuntimeClient,
  'cancelTurn' | 'listRuntimeActivities' | 'terminateBackgroundShellProcess'
>;

export function useRuntimeActivitySnapshot({
  client,
  onActivitiesChanged,
}: {
  client: RuntimeActivityClient;
  onActivitiesChanged?: () => unknown;
}) {
  const [snapshot, setSnapshot] = useState<RuntimeActivityList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stoppingKeys, setStoppingKeys] = useState<Set<string>>(() => new Set());
  const requests = useLatestRequestGuard();

  const refresh = useCallback(async (showLoading = false) => {
    const isLatest = requests.begin();
    if (showLoading) setLoading(true);
    try {
      const next = await client.listRuntimeActivities();
      if (!isLatest()) return;
      setSnapshot(next);
      setError(null);
    } catch (unknownError) {
      if (isLatest()) setError(runtimeActivityErrorMessage(unknownError));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [client, requests]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async (first = false) => {
      await refresh(first);
      if (!cancelled) {
        timeoutId = window.setTimeout(poll, RUNTIME_ACTIVITY_POLL_INTERVAL_MS);
      }
    };
    void poll(true);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      requests.invalidate();
    };
  }, [refresh, requests]);

  const runStop = useCallback(async (
    key: string,
    stop: () => Promise<unknown>,
    remove: (current: RuntimeActivityList) => RuntimeActivityList,
  ) => {
    setStoppingKeys((current) => new Set(current).add(key));
    setError(null);
    try {
      await stop();
      setSnapshot((current) => current ? remove(current) : current);
      await Promise.all([
        refresh(),
        Promise.resolve(onActivitiesChanged?.()).catch((unknownError) => {
          setError(runtimeActivityErrorMessage(unknownError));
        }),
      ]);
    } catch (unknownError) {
      setError(runtimeActivityErrorMessage(unknownError));
    } finally {
      setStoppingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [onActivitiesChanged, refresh]);

  const stopTask = useCallback((task: RuntimeActiveTask, key: string) => runStop(
    key,
    () => client.cancelTurn(task.threadId, task.turnId),
    (current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.threadId !== task.threadId || item.turnId !== task.turnId),
    }),
  ), [client, runStop]);

  const stopService = useCallback((service: RuntimeBackgroundServiceActivity, key: string) => runStop(
    key,
    () => client.terminateBackgroundShellProcess(service.threadId, service.id),
    (current) => ({
      ...current,
      backgroundServices: current.backgroundServices.filter((item) => (
        item.threadId !== service.threadId || item.id !== service.id
      )),
    }),
  ), [client, runStop]);

  return {
    error,
    loading,
    refresh,
    snapshot,
    stoppingKeys,
    stopService,
    stopTask,
  };
}

function runtimeActivityErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
