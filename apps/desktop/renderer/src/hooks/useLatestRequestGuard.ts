import { useEffect, useRef } from 'react';

export type LatestRequestGuard = {
  begin(): () => boolean;
  invalidate(): void;
};

export function createLatestRequestGuard(): LatestRequestGuard {
  let revision = 0;
  return {
    begin() {
      const requestRevision = ++revision;
      return () => requestRevision === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}

/** Gives async UI actions a shared last-request-wins boundary. */
export function useLatestRequestGuard(): LatestRequestGuard {
  const guardRef = useRef<LatestRequestGuard | null>(null);
  if (!guardRef.current) guardRef.current = createLatestRequestGuard();
  const guard = guardRef.current;

  useEffect(() => () => guard.invalidate(), [guard]);
  return guard;
}
