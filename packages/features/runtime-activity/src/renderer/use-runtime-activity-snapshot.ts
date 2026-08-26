import type {
  RuntimeActiveTask,
  RuntimeActivityList,
  RuntimeBackgroundServiceActivity,
  RuntimeActivityRendererService,
} from '../contracts/index.js';
import { useCallback, useEffect, useRef, useState } from 'react';

const RUNTIME_ACTIVITY_POLL_INTERVAL_MS = 2_000;

export function useRuntimeActivitySnapshot({
  service,
  onActivitiesChanged,
}: {
  service: RuntimeActivityRendererService;
  onActivitiesChanged?: () => unknown;
}) {
  const [snapshot, setSnapshot] = useState<RuntimeActivityList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stoppingKeys, setStoppingKeys] = useState<Set<string>>(() => new Set());
  const requests = useRuntimeActivityRequestGuard();

  const refresh = useCallback(async (showLoading = false) => {
    const isLatest = requests.begin();
    if (showLoading) setLoading(true);
    try {
      const next = await service.list();
      if (!isLatest()) return;
      setSnapshot(next);
      setError(null);
    } catch (unknownError) {
      if (isLatest()) setError(runtimeActivityErrorMessage(unknownError));
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [requests, service]);

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
    () => service.stopTask({ threadId: task.threadId, turnId: task.turnId }),
    (current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.threadId !== task.threadId || item.turnId !== task.turnId),
    }),
  ), [runStop, service]);

  const stopService = useCallback((activity: RuntimeBackgroundServiceActivity, key: string) => runStop(
    key,
    () => service.stopService({ processId: activity.id, threadId: activity.threadId }),
    (current) => ({
      ...current,
      backgroundServices: current.backgroundServices.filter((item) => (
        item.threadId !== activity.threadId || item.id !== activity.id
      )),
    }),
  ), [runStop, service]);

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

function useRuntimeActivityRequestGuard() {
  const revisionRef = useRef(0);
  const guardRef = useRef({
    begin: () => {
      const requestRevision = ++revisionRef.current;
      return () => requestRevision === revisionRef.current;
    },
    invalidate: () => {
      revisionRef.current += 1;
    },
  });
  return guardRef.current;
}

function runtimeActivityErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
