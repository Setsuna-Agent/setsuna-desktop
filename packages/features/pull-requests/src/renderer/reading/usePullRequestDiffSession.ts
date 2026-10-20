import { useCallback, useState } from 'react';
import type { PullRequestDetailSession, PullRequestDiffSession } from '../session.js';

export function usePullRequestDiffSession(session: PullRequestDetailSession) {
  const [view, setView] = useState(session.diff);
  const update = useCallback((patch: Partial<PullRequestDiffSession>) => {
    session.diff = { ...session.diff, ...patch };
    setView(session.diff);
  }, [session]);
  return { view, update };
}
