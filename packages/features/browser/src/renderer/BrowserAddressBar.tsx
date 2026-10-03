import { TextField, Button } from '@setsuna-desktop/renderer-ui';

import { ExternalLink } from 'lucide-react';
import { useId } from 'react';
import type { BrowserHistoryEntry } from './browserHistory.js';
import type { BrowserTranslate } from './messages.js';
import { BrowserAddressSuggestions } from './address-bar/BrowserAddressSuggestions.js';
import { useBrowserAddressSuggestions } from './address-bar/useBrowserAddressSuggestions.js';
import './address-bar/address-bar.css';

export function BrowserAddressBar({
  externalUrl,
  hidden,
  history,
  onChange,
  onNavigate,
  onOpenExternal,
  onRefreshHistory,
  onRemoveHistory,
  translate,
  value,
}: {
  externalUrl: string | null;
  hidden: boolean;
  history: readonly BrowserHistoryEntry[];
  onChange: (value: string) => void;
  onNavigate: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onRefreshHistory: () => void;
  onRemoveHistory: (url: string) => void;
  translate: BrowserTranslate;
  value: string;
}) {
  const suggestionsId = useId();
  const suggestions = useBrowserAddressSuggestions({ hidden, history, onChange, onNavigate, onRefreshHistory, onRemoveHistory, value });
  return (
    <form
      className="desktop-browser-address-form"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) suggestions.close();
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
          value={value}
          onChange={(event) => suggestions.change(event.currentTarget.value)}
          onCompositionStart={() => { suggestions.composing.current = true; }}
          onCompositionEnd={() => { suggestions.composing.current = false; }}
          onKeyDown={suggestions.onKeyDown}
          onFocus={(event) => { event.currentTarget.select(); suggestions.focus(); }}
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
