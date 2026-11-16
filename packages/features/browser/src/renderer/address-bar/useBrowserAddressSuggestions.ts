import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { BrowserBookmarkEntry } from '../browserBookmarks.js';
import type { BrowserHistoryEntry } from '../browserHistory.js';
import { browserSearchUrl, normalizeBrowserInput } from '../browserNavigation.js';
import { browserAddressSuggestions, type BrowserAddressPage } from './browserAddressCandidates.js';
import type { BrowserSearchEngine } from '../../contracts/settings.js';

export function useBrowserAddressSuggestions({ hidden, history, bookmarks, pinnedPages, onChange, onNavigate, onSearch, onRefreshHistory, onRefreshBookmarks, onRemoveHistory, value, searchEngine }: {
  searchEngine?: BrowserSearchEngine;
  hidden: boolean;
  history: readonly BrowserHistoryEntry[];
  bookmarks: readonly BrowserBookmarkEntry[];
  pinnedPages?: readonly BrowserAddressPage[];
  onChange: (value: string) => void;
  onNavigate: (url: string) => void;
  onSearch?: (query: string) => void;
  onRefreshHistory: () => void;
  onRefreshBookmarks: () => void;
  onRemoveHistory?: (url: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ query: string; id: string } | null>(null);
  const suggestions = useMemo(() => browserAddressSuggestions(value, history, bookmarks, searchEngine, pinnedPages), [value, history, bookmarks, searchEngine, pinnedPages]);
  const activeIndex = Math.max(0, suggestions.findIndex((item) => selection?.query === value && item.id === selection.id));
  const visible = open && !hidden && suggestions.length > 0;

  useEffect(() => { setOpen(false); }, [hidden]);

  const select = (index: number) => {
    const item = suggestions[index];
    if (item) setSelection({ query: value, id: item.id });
  };
  const close = () => setOpen(false);
  const navigate = (url: string, searchQuery?: string) => {
    close();
    inputRef.current?.blur();
    // The homepage resolves the current engine on submission, without fetching preferences on focus.
    if (searchQuery !== undefined && onSearch) onSearch(searchQuery);
    else onNavigate(url);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME Enter confirms text, and must never submit a stale address suggestion.
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      select(visible ? (activeIndex + step + suggestions.length) % suggestions.length : step > 0 ? 0 : suggestions.length - 1);
    } else if (event.key === 'Delete' && event.shiftKey && visible) {
      const item = suggestions[activeIndex];
      if (item.kind === 'history' && onRemoveHistory) {
        event.preventDefault();
        onRemoveHistory(item.url);
      }
    }
  };

  return {
    activeIndex, close, composing, inputRef, navigate, onKeyDown, select, suggestions, visible,
    change: (next: string) => { setOpen(true); setSelection(null); onChange(next); },
    focus: () => { setOpen(true); setSelection(null); onRefreshHistory(); onRefreshBookmarks(); },
    submit: () => {
      if (composing.current) return;
      const selected = visible ? suggestions[activeIndex] : undefined;
      const url = selected?.url ?? normalizeBrowserInput(value, searchEngine);
      const searchQuery = selected
        ? selected.kind === 'search' ? selected.title : undefined
        : url === browserSearchUrl(value, searchEngine) ? value.trim() : undefined;
      navigate(url, searchQuery);
    },
  };
}
