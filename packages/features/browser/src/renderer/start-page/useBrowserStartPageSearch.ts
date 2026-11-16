import { useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import { useBrowserAddressSuggestions } from '../address-bar/useBrowserAddressSuggestions.js';
import { readBrowserBookmarks, type BrowserBookmarkEntry } from '../browserBookmarks.js';
import { readBrowserHistory, type BrowserHistoryEntry } from '../browserHistory.js';
import { browserSearchUrl } from '../browserNavigation.js';
import type { BrowserTranslate } from '../messages.js';
import { readBrowserPinnedPages, type BrowserPinnedPage } from './browserPinnedPages.js';

export type BrowserStartPageSearchProps = {
  bridge: Pick<BrowserDesktopBridge, 'getBrowserPreferences'> | null;
  onNavigate(url: string): void;
  onError(message: string): void;
  translate: BrowserTranslate;
};

export function useBrowserStartPageSearch({ bridge, onNavigate, onError, translate: t }: BrowserStartPageSearchProps) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkEntry[]>([]);
  const [pinnedPages, setPinnedPages] = useState<BrowserPinnedPage[]>([]);
  const request = useRef(0);
  const pending = useRef(false);

  useEffect(() => () => { request.current += 1; }, []);

  const cancelSearch = () => {
    request.current += 1;
    pending.current = false;
    setBusy(false);
  };
  const search = async (value: string) => {
    if (!value.trim() || pending.current) return;
    const revision = ++request.current;
    pending.current = true;
    setBusy(true);
    try {
      if (!bridge) throw new Error('Browser unavailable.');
      const { searchEngine } = await bridge.getBrowserPreferences();
      // Editing/clearing the query or closing the panel invalidates late settings responses.
      if (request.current === revision) onNavigate(browserSearchUrl(value, searchEngine));
    } catch {
      if (request.current === revision) onError(t('feature.browser.searchFailed'));
    } finally {
      if (request.current === revision) { pending.current = false; setBusy(false); }
    }
  };

  const suggestions = useBrowserAddressSuggestions({
    hidden: false, history, bookmarks, pinnedPages, value: query,
    onChange: (value) => { cancelSearch(); setQuery(value); },
    onNavigate: (url) => { cancelSearch(); onNavigate(url); },
    onSearch: (value) => { void search(value); },
    // Read local suggestions only when the user focuses the field, not on the startup path.
    onRefreshHistory: () => setHistory(readBrowserHistory()),
    onRefreshBookmarks: () => {
      setBookmarks(readBrowserBookmarks());
      try { setPinnedPages(readBrowserPinnedPages()); } catch { setPinnedPages([]); }
    },
  });

  return {
    ...suggestions, query, busy,
    clear: () => { suggestions.change(''); suggestions.inputRef.current?.focus(); },
    submit: () => {
      if (query.trim() || suggestions.visible) suggestions.submit();
    },
  };
}
