import { useCallback, useState } from 'react';
import {
  readBrowserBookmarks,
  toggleBrowserBookmark,
  writeBrowserBookmarks,
  type BrowserBookmarkInput,
} from './browserBookmarks.js';

export function useBrowserBookmarks() {
  const [entries, setEntries] = useState(readBrowserBookmarks);

  const toggle = useCallback((input: BrowserBookmarkInput) => {
    const next = toggleBrowserBookmark(readBrowserBookmarks(), input);
    writeBrowserBookmarks(next);
    setEntries(next);
  }, []);

  const refresh = useCallback(() => setEntries(readBrowserBookmarks()), []);

  return { entries, refresh, toggle };
}
