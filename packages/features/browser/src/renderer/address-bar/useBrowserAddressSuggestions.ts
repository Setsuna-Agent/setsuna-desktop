import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BrowserHistoryEntry } from '../browserHistory.js';
import { normalizeBrowserInput } from '../browserNavigation.js';
import { browserAddressSuggestions } from './browserAddressCandidates.js';
import type { BrowserSearchEngine } from '../../contracts/settings.js';

export function useBrowserAddressSuggestions({ hidden, history, onChange, onNavigate, onRefreshHistory, onRemoveHistory, value, searchEngine }: {
  searchEngine?: BrowserSearchEngine;
  hidden: boolean;
  history: readonly BrowserHistoryEntry[];
  onChange: (value: string) => void;
  onNavigate: (url: string) => void;
  onRefreshHistory: () => void;
  onRemoveHistory: (url: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ query: string; id: string } | null>(null);
  const suggestions = browserAddressSuggestions(value, history, searchEngine);
  const activeIndex = Math.max(0, suggestions.findIndex((item) => selection?.query === value && item.id === selection.id));
  const visible = open && !hidden && suggestions.length > 0;

  useEffect(() => { setOpen(false); }, [hidden]);

  const select = (index: number) => {
    const item = suggestions[index];
    if (item) setSelection({ query: value, id: item.id });
  };
  const close = () => setOpen(false);
  const navigate = (url: string) => {
    close();
    inputRef.current?.blur();
    onNavigate(url);
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
      if (item.kind === 'history') {
        event.preventDefault();
        onRemoveHistory(item.url);
      }
    }
  };

  return {
    activeIndex, close, composing, inputRef, navigate, onKeyDown, select, suggestions, visible,
    change: (next: string) => { setOpen(true); setSelection(null); onChange(next); },
    focus: () => { setOpen(true); setSelection(null); onRefreshHistory(); },
    submit: () => {
      if (!composing.current) navigate(visible ? suggestions[activeIndex].url : normalizeBrowserInput(value, searchEngine));
    },
  };
}
