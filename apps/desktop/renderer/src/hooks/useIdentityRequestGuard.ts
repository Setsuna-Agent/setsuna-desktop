import { useEffect, useRef } from 'react';
import { createLatestRequestGuard } from './useLatestRequestGuard.js';

export type IdentityRequestGuard = {
  begin(): () => boolean;
  invalidate(): void;
  updateIdentity(identity: string): void;
};

/**
 * Combines "latest request wins" with an owner identity. A request becomes stale as
 * soon as navigation changes its owner, even before a React effect has run.
 */
export function createIdentityRequestGuard(initialIdentity: string): IdentityRequestGuard {
  const requests = createLatestRequestGuard();
  let identity = initialIdentity;

  return {
    begin() {
      const requestIdentity = identity;
      const isLatest = requests.begin();
      return () => requestIdentity === identity && isLatest();
    },
    invalidate() {
      requests.invalidate();
    },
    updateIdentity(nextIdentity) {
      if (nextIdentity === identity) return;
      identity = nextIdentity;
      requests.invalidate();
    },
  };
}

export function useIdentityRequestGuard(identity: string): IdentityRequestGuard {
  const guardRef = useRef<IdentityRequestGuard | null>(null);
  if (!guardRef.current) guardRef.current = createIdentityRequestGuard(identity);
  const guard = guardRef.current;
  guard.updateIdentity(identity);

  useEffect(() => () => guard.invalidate(), [guard]);
  return guard;
}
