import { TextField, Button } from '@setsuna-desktop/renderer-ui';

import { ExternalLink } from 'lucide-react';
import { useId, useLayoutEffect, useState } from 'react';
import type { BrowserSearchEngine } from '../contracts/settings.js';
import type { BrowserBookmarkEntry } from './browserBookmarks.js';
import type { BrowserHistoryEntry } from './browserHistory.js';
import type { BrowserTranslate } from './messages.js';
import { BrowserAddressSuggestions } from './address-bar/BrowserAddressSuggestions.js';
import { useBrowserAddressSuggestions } from './address-bar/useBrowserAddressSuggestions.js';
import './address-bar/address-bar.css';

export function BrowserAddressBar({
  externalUrl,
  hidden,
  history,
  bookmarks,
  onChange,
  onNavigate,
  onOpenExternal,
  onRefreshHistory,
  onRefreshBookmarks,
  onRemoveHistory,
  translate,
  value,
  showFullUrl = true,
  searchEngine,
}: {
  showFullUrl?: boolean;
  searchEngine?: BrowserSearchEngine;
  externalUrl: string | null;
  hidden: boolean;
  history: readonly BrowserHistoryEntry[];
  bookmarks: readonly BrowserBookmarkEntry[];
  onChange: (value: string) => void;
  onNavigate: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onRefreshHistory: () => void;
  onRefreshBookmarks: () => void;
  onRemoveHistory: (url: string) => void;
  translate: BrowserTranslate;
  value: string;
}) {
  const suggestionsId = useId();
  const [focused, setFocused] = useState(false);
  const suggestions = useBrowserAddressSuggestions({ hidden, history, bookmarks, onChange, onNavigate,
    onRefreshHistory, onRefreshBookmarks, onRemoveHistory, value, searchEngine });
  useLayoutEffect(() => {
    if (focused) suggestions.inputRef.current?.select();
  }, [focused, suggestions.inputRef]);
  let displayValue = value;
  if (!showFullUrl && !focused && externalUrl === value) {
    try { displayValue = new URL(value).host; } catch { /* Keep partially entered text intact. */ }
  }
  return (
    <form
      className="desktop-browser-address-form"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) { suggestions.close(); setFocused(false); }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        suggestions.submit();
      }}
    >
      <span className="desktop-browser-address-bar">
        <TextField
          aria-autocomplete="list"
          aria-controls={suggestions.visible ? suggestionsId : undefined}
          aria-activedescendant={suggestions.visible ? `${suggestionsId}-${suggestions.activeIndex}` : undefined}
          aria-expanded={suggestions.visible}
          aria-haspopup="grid"
          aria-label={translate('feature.browser.address')}
          autoComplete="off"
          autoCapitalize="none"
          ref={suggestions.inputRef}
          role="combobox"
          spellCheck={false}
          value={displayValue}
          onChange={(event) => suggestions.change(event.currentTarget.value)}
          onCompositionStart={() => { suggestions.composing.current = true; }}
          onCompositionEnd={() => { suggestions.composing.current = false; }}
          onKeyDown={suggestions.onKeyDown}
          onFocus={() => { setFocused(true); suggestions.focus(); }}
        />
        {externalUrl ? (
          <Button variant="ghost"
            aria-label={translate('feature.browser.openExternal')}
            className="desktop-browser-address-bar__external"
            title={translate('feature.browser.openExternal')}
            type="button"
            onClick={() => onOpenExternal(externalUrl)}
          >
            <ExternalLink size={13} />
          </Button>
        ) : null}
      </span>
      {suggestions.visible ? (
        <BrowserAddressSuggestions
          activeIndex={suggestions.activeIndex}
          id={suggestionsId}
          onNavigate={suggestions.navigate}
          onRemove={onRemoveHistory}
          onSelect={suggestions.select}
          suggestions={suggestions.suggestions}
          translate={translate}
        />
      ) : null}
    </form>
  );
}
