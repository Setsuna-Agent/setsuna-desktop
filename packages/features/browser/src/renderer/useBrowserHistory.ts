import { useCallback, useEffect, useState } from 'react';
import { browserHistoryDay } from './records/historyGroups.js';
import {
  addBrowserHistoryVisit,
  readBrowserHistory,
  removeBrowserHistoryEntry,
  writeBrowserHistory,
  BROWSER_HISTORY_CHANGED,
  BROWSER_HISTORY_STORAGE_KEY,
  type BrowserHistoryVisit,
} from './browserHistory.js';

export function useBrowserHistory() {
  const [entries, setEntries] = useState(readBrowserHistory);
  const [error, setError] = useState(false);
  const persist = useCallback((next: ReturnType<typeof readBrowserHistory>) => {
    const saved = writeBrowserHistory(next);
    setError(!saved);
    if (saved) setEntries(next);
    return saved;
  }, []);

  const recordVisit = useCallback((visit: BrowserHistoryVisit, updateOnly = false) => {
    // localStorage is the shared projection for every mounted browser panel.
    // Re-read before each mutation so concurrent panels cannot overwrite visits.
    const current = readBrowserHistory();
    // A late title event must not resurrect a visit the user just cleared or replace a newer visit from another tab.
    if (updateOnly && !current.some((entry) => entry.url === visit.url && entry.visitedAt === visit.visitedAt)) return;
    const next = addBrowserHistoryVisit(current, visit);
    persist(next);
  }, [persist]);

  const refresh = useCallback(() => setEntries(readBrowserHistory()), []);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (!event.key || event.key === BROWSER_HISTORY_STORAGE_KEY) refresh(); };
    window.addEventListener(BROWSER_HISTORY_CHANGED, refresh);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(BROWSER_HISTORY_CHANGED, refresh); window.removeEventListener('storage', storage); };
  }, [refresh]);

  const removeEntry = useCallback((url: string) => {
    const next = removeBrowserHistoryEntry(readBrowserHistory(), url);
    return persist(next);
  }, [persist]);

  const clear = useCallback(() => persist([]), [persist]);
  const removeDay = useCallback((day: string) => persist(readBrowserHistory().filter((entry) => browserHistoryDay(entry.visitedAt) !== day)), [persist]);

  return { entries, error, recordVisit, refresh, removeEntry, clear, removeDay };
}
