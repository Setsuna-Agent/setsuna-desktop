import { useEffect, useRef } from 'react';

type ReviewRequestGuard = {
  begin(): () => boolean;
  invalidate(): void;
};

function createReviewRequestGuard(): ReviewRequestGuard {
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

/** Keeps late native Git requests from replacing a newer workspace snapshot. */
export function useReviewRequestGuard(): ReviewRequestGuard {
  const guardRef = useRef<ReviewRequestGuard | null>(null);
  if (!guardRef.current) guardRef.current = createReviewRequestGuard();
  const guard = guardRef.current;
  useEffect(() => () => guard.invalidate(), [guard]);
  return guard;
}
