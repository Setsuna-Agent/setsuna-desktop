import { useCallback, useEffect, useState } from 'react';
import type { ProcessResourceSnapshot, RuntimeActivityDesktopBridge, RuntimeActivityRendererService } from '../contracts/index.js';
import { mergeResourceProcesses, processResourceUsage, type ProcessResourceUsage } from './resource-model.js';

export function useResourceSnapshot(desktopBridge: RuntimeActivityDesktopBridge | null, service: RuntimeActivityRendererService) {
  const [processes, setProcesses] = useState<readonly ProcessResourceUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    let previousDesktop: ProcessResourceSnapshot | null = null;
    let previousRuntime: ProcessResourceSnapshot | null = null;
    const poll = async () => {
      if (disposed || document.hidden) return;
      const current = ++generation;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(new Error('Resource sampling timed out.')), 5_000);
      const results = await Promise.allSettled([
        withCancellation(Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          if (!desktopBridge) throw new Error('Desktop resource metrics are unavailable.');
          return desktopBridge.sampleResources();
        }), controller.signal),
        withCancellation(Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return service.sampleResources({ signal: controller.signal });
        }), controller.signal),
      ]);
      clearTimeout(timeout);
      if (disposed || current !== generation) return;
      request = null;
      const [desktop, runtime] = results;
      const desktopUsage = desktop.status === 'fulfilled' ? processResourceUsage(desktop.value, previousDesktop) : [];
      const runtimeUsage = runtime.status === 'fulfilled' ? processResourceUsage(runtime.value, previousRuntime) : [];
      previousDesktop = desktop.status === 'fulfilled' ? desktop.value : null;
      previousRuntime = runtime.status === 'fulfilled' ? runtime.value : null;
      setProcesses(mergeResourceProcesses(desktopUsage, runtimeUsage));
      setError(results.filter((result) => result.status === 'rejected').map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason)).join('; ') || null);
      setLoading(false);
      timer = setTimeout(() => void poll(), 2_000);
    };
    const visibilityChanged = () => {
      generation += 1;
      clearTimeout(timer);
      request?.abort();
      previousDesktop = null;
      previousRuntime = null;
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    void poll();
    return () => {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [desktopBridge, revision, service]);
  return { processes, loading, error, refresh };
}

function withCancellation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
