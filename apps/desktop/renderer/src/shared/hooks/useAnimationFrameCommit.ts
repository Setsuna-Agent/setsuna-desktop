import { useCallback, useEffect, useMemo, useRef } from 'react';

export type AnimationFrameCommit<T> = {
  commitNow(value: T): void;
  schedule(value: T): void;
};

/**
 * Coalesces high-frequency projections into one React commit per browser frame.
 * Immediate commits cancel queued work so an older streamed snapshot can never
 * overwrite a navigation or optimistic mutation.
 */
export function useAnimationFrameCommit<T>(commit: (value: T) => void): AnimationFrameCommit<T> {
  const commitRef = useRef(commit);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);
  commitRef.current = commit;

  const cancel = useCallback(() => {
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
    pendingRef.current = null;
  }, []);

  const commitNow = useCallback((value: T) => {
    cancel();
    commitRef.current(value);
  }, [cancel]);

  const schedule = useCallback((value: T) => {
    pendingRef.current = { value };
    if (frameRef.current !== null) return;
    if (typeof window === 'undefined') {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) commitRef.current(pending.value);
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) commitRef.current(pending.value);
    });
  }, []);

  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ commitNow, schedule }), [commitNow, schedule]);
}
