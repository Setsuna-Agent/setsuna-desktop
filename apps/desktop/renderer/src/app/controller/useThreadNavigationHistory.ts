import { useCallback, useEffect, useRef, useState } from 'react';

type ThreadNavigationHistory = {
  entries: string[];
  index: number;
};

type PendingNavigation = {
  index: number;
  threadId: string;
};

export function useThreadNavigationHistory({
  currentThreadId,
  onOpenThread,
}: {
  currentThreadId: string | null;
  onOpenThread: (threadId: string) => Promise<unknown>;
}) {
  const initialHistory = useRef<ThreadNavigationHistory>({
    entries: currentThreadId ? [currentThreadId] : [],
    index: currentThreadId ? 0 : -1,
  });
  const historyRef = useRef(initialHistory.current);
  const currentThreadIdRef = useRef(currentThreadId);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const [history, setHistory] = useState(initialHistory.current);
  const [navigating, setNavigating] = useState(false);

  currentThreadIdRef.current = currentThreadId;

  useEffect(() => {
    if (!currentThreadId) return;

    const current = historyRef.current;
    const pending = pendingNavigationRef.current;
    if (
      pending
      && pending.threadId === currentThreadId
      && current.entries[pending.index] === currentThreadId
    ) {
      pendingNavigationRef.current = null;
      if (current.index === pending.index) return;
      const next = { ...current, index: pending.index };
      historyRef.current = next;
      setHistory(next);
      return;
    }

    pendingNavigationRef.current = null;
    if (current.entries[current.index] === currentThreadId) return;

    // Opening a thread outside the arrows starts a new branch and discards the old forward branch.
    const entries = [...current.entries.slice(0, current.index + 1), currentThreadId];
    const next = { entries, index: entries.length - 1 };
    historyRef.current = next;
    setHistory(next);
  }, [currentThreadId]);

  const navigateToIndex = useCallback((index: number) => {
    const current = historyRef.current;
    const threadId = current.entries[index];
    if (!threadId || navigating) return;

    pendingNavigationRef.current = { index, threadId };
    setNavigating(true);
    void onOpenThread(threadId).then(
      () => setNavigating(false),
      () => {
        if (currentThreadIdRef.current !== threadId) pendingNavigationRef.current = null;
        setNavigating(false);
      },
    );
  }, [navigating, onOpenThread]);

  const goBack = useCallback(() => {
    navigateToIndex(historyRef.current.index - 1);
  }, [navigateToIndex]);
  const goForward = useCallback(() => {
    navigateToIndex(historyRef.current.index + 1);
  }, [navigateToIndex]);

  return {
    canGoBack: !navigating && history.index > 0,
    canGoForward: !navigating && history.index >= 0 && history.index < history.entries.length - 1,
    goBack,
    goForward,
  };
}
