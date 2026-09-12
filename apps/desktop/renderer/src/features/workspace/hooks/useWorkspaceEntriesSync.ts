import { useEffect, useRef } from 'react';

export type WorkspaceEntriesWatcher = (directoryPaths: string[], callback: () => void) => () => void;

/** Coalesce invalidations while a snapshot is loading, and unsubscribe with its workspace owner. */
export function useWorkspaceEntriesSync({ enabled, identity, directoryPaths, watchEntries, refresh }: {
  enabled: boolean;
  identity: string;
  directoryPaths: string[];
  watchEntries?: WorkspaceEntriesWatcher;
  refresh(isCurrent: () => boolean): Promise<void>;
}) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const directoryKey = JSON.stringify([...new Set(directoryPaths)].sort());
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let pending = false;
    const refreshCurrent = async () => {
      pending = true;
      if (running || disposed) return;
      running = true;
      try {
        do {
          pending = false;
          await refreshRef.current(() => !disposed);
        } while (pending && !disposed);
      } finally {
        running = false;
      }
    };
    const changed = () => { void refreshCurrent(); };
    const unsubscribe = watchEntries?.(JSON.parse(directoryKey) as string[], changed);
    // Refocus also repairs missed OS notifications or a temporarily unavailable watcher.
    window.addEventListener('focus', changed);
    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener('focus', changed);
    };
  }, [directoryKey, enabled, identity, watchEntries]);
}
