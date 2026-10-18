import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Incomplete projections recover even after the active turn ends. Coalesce into one request;
 * a stale/failed response retries without trusting the conditional polling sequence. */
export function useThreadSnapshotRecovery(
  client: Pick<DesktopRuntimeClient, 'getThread'>,
  threadId: string | null,
  accept: (threadId: string, snapshot: RuntimeThread) => boolean,
) {
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const ownerRef = useRef(threadId);
  ownerRef.current = threadId;

  useEffect(() => {
    if (!pendingThreadId) return;
    if (pendingThreadId !== threadId) {
      setPendingThreadId(null);
      return;
    }
    let cancelled = false;
    let retry: number | undefined;
    const recover = async () => {
      try {
        const snapshot = await client.getThread(pendingThreadId);
        if (cancelled || ownerRef.current !== pendingThreadId) return;
        if (acceptRef.current(pendingThreadId, snapshot)) {
          setPendingThreadId(null);
          return;
        }
      } catch {
        // A temporary transport failure must not turn a known-incomplete projection healthy.
      }
      if (!cancelled) retry = window.setTimeout(recover, 1000);
    };
    void recover();
    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [client, pendingThreadId, threadId]);

  return useCallback((owner: string) => {
    if (ownerRef.current === owner) setPendingThreadId(owner);
  }, []);
}
