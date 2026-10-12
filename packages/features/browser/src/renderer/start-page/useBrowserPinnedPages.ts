import { useCallback, useEffect, useState } from 'react';
import { BROWSER_PINNED_PAGES_CHANGED, BROWSER_PINNED_PAGES_KEY, readBrowserPinnedPages,
  toggleBrowserPinnedPage, type BrowserPinnedPage } from './browserPinnedPages.js';

function loadPages() {
  try { return readBrowserPinnedPages(); } catch { return []; }
}

export function useBrowserPinnedPages() {
  const [pages, setPages] = useState(loadPages);
  useEffect(() => {
    const refresh = () => setPages(loadPages());
    const storage = (event: StorageEvent) => { if (!event.key || event.key === BROWSER_PINNED_PAGES_KEY) refresh(); };
    window.addEventListener(BROWSER_PINNED_PAGES_CHANGED, refresh);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(BROWSER_PINNED_PAGES_CHANGED, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const toggle = useCallback((page: BrowserPinnedPage) => {
    try { toggleBrowserPinnedPage(page); return true; } catch { return false; }
  }, []);
  return { pages, toggle };
}
