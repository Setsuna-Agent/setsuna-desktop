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

/** 为异步界面操作提供共享的“最后一次请求生效”边界。 */
export function useLatestRequestGuard(): LatestRequestGuard {
  const guardRef = useRef<LatestRequestGuard | null>(null);
  if (!guardRef.current) guardRef.current = createLatestRequestGuard();
  const guard = guardRef.current;

  useEffect(() => () => guard.invalidate(), [guard]);
  return guard;
}
