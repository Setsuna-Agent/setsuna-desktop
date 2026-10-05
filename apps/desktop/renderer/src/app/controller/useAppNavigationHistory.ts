import { useCallback, useEffect, useRef, useState } from 'react';
import type { MainView } from '../types.js';

export type AppNavigationLocation =
  | { view: 'chat'; threadId: string | null; projectId: string | null; draftId?: string }
  | { view: 'capabilities'; pluginId: string | null }
  | { view: 'plugin'; viewKey: string | null }
  | { view: Exclude<MainView, 'chat' | 'capabilities' | 'plugin'> };

type HistoryEntry = { key: string; location: AppNavigationLocation };
type NavigationHistory = { entries: HistoryEntry[]; index: number };
type PendingNavigation = { index: number; key: string };

/** Track committed destinations so cancelled or failed navigation never advances history. */
export function useAppNavigationHistory({ location, onNavigate, onError }: {
  location: AppNavigationLocation;
  onNavigate: (location: AppNavigationLocation) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const key = JSON.stringify(location);
  const [history, setHistory] = useState<NavigationHistory>(() => ({ entries: [{ key, location }], index: 0 }));
  const historyRef = useRef(history);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const navigatingRef = useRef(false);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    const current = historyRef.current;
    const pending = pendingRef.current;
    if (pending && pending.key === key && current.entries[pending.index]?.key === key) {
      pendingRef.current = null;
      const next = { ...current, index: pending.index };
      historyRef.current = next;
      setHistory(next);
      return;
    }
    if (current.entries[current.index].key === key) {
      // A resolved request with no destination change was cancelled by a guard.
      if (!navigating) pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    // Navigating outside the arrows replaces the old forward branch.
    const entries = [...current.entries.slice(0, current.index + 1), { key, location }];
    const next = { entries, index: entries.length - 1 };
    historyRef.current = next;
    setHistory(next);
    // The serialized destination is the identity; new prop objects are not new visits.
  }, [key, navigating]);

  const navigateToIndex = useCallback((index: number) => {
    const entry = historyRef.current.entries[index];
    if (!entry || navigatingRef.current) return;
    pendingRef.current = { index, key: entry.key };
    // Lock synchronously, including repeated shortcut events before React commits.
    navigatingRef.current = true;
    setNavigating(true);
    void Promise.resolve().then(() => onNavigate(entry.location)).catch(onError).finally(() => {
      navigatingRef.current = false;
      setNavigating(false);
    });
  }, [onError, onNavigate]);

  const goBack = useCallback(() => navigateToIndex(historyRef.current.index - 1), [navigateToIndex]);
  const goForward = useCallback(() => navigateToIndex(historyRef.current.index + 1), [navigateToIndex]);

  return {
    canGoBack: !navigating && history.index > 0,
    canGoForward: !navigating && history.index < history.entries.length - 1,
    goBack,
    goForward,
  };
}
