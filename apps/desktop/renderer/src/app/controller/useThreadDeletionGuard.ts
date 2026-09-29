import type { DesktopThreadDeletionState } from '@setsuna-desktop/contracts';
import { useEffect, useRef } from 'react';

/** Main owns confirmation; keep the existing editor untouched until deletion commits. */
export function useThreadDeletionGuard(state: DesktopThreadDeletionState) {
  const latest = useRef(state);
  latest.current = state;
  const releaseRef = useRef<() => void>(() => undefined);
  const awaitingDeletedThread = useRef<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    if (awaitingDeletedThread.current === state.threadId) return;
    awaitingDeletedThread.current = null;
    if (!checking.current) releaseRef.current();
  }, [state.threadId]);

  useEffect(() => {
    const bridge = window.setsunaDesktop?.runtime;
    if (!bridge?.onThreadDeletionCheck) return;
    let unlock: (() => void) | null = null;
    const release = () => { unlock?.(); unlock = null; };
    releaseRef.current = release;
    const unsubscribe = bridge.onThreadDeletionCheck(() => {
      checking.current = true;
      if (!unlock) {
        const wasInert = document.body.inert;
        document.body.inert = true;
        const stopInput = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
        window.addEventListener('keydown', stopInput, true);
        unlock = () => {
          document.body.inert = wasInert;
          window.removeEventListener('keydown', stopInput, true);
        };
      }
      return latest.current;
    }, ({ deletedThreadIds }) => {
      checking.current = false;
      const threadId = latest.current.threadId;
      // HTTP can complete before SSE delivers thread.deleted. Keep input paused
      // until its projection has cleared the old workspace, closing that race.
      if (threadId && deletedThreadIds.includes(threadId)) awaitingDeletedThread.current = threadId;
      if (awaitingDeletedThread.current !== threadId || threadId === null) release();
    });
    return () => { unsubscribe(); release(); checking.current = false; };
  }, []);
}
