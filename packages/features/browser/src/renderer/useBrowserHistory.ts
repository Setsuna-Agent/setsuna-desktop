import { useCallback, useState } from 'react';
import {
  addBrowserHistoryVisit,
  readBrowserHistory,
  removeBrowserHistoryEntry,
  writeBrowserHistory,
  type BrowserHistoryVisit,
} from './browserHistory.js';

export function useBrowserHistory() {
  const [entries, setEntries] = useState(readBrowserHistory);

  const recordVisit = useCallback((visit: BrowserHistoryVisit) => {
    // localStorage is the shared projection for every mounted browser panel.
    // Re-read before each mutation so concurrent panels cannot overwrite visits.
    const next = addBrowserHistoryVisit(readBrowserHistory(), visit);
    writeBrowserHistory(next);
    setEntries(next);
  }, []);

  const refresh = useCallback(() => setEntries(readBrowserHistory()), []);

  const removeEntry = useCallback((url: string) => {
    const next = removeBrowserHistoryEntry(readBrowserHistory(), url);
    writeBrowserHistory(next);
    setEntries(next);
  }, []);

  return { entries, recordVisit, refresh, removeEntry };
}
