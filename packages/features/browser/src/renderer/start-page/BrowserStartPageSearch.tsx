import { IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { Search, X } from 'lucide-react';
import { useId } from 'react';
import { BrowserStartPageSuggestions } from './BrowserStartPageSuggestions.js';
import { useBrowserStartPageSearch, type BrowserStartPageSearchProps } from './useBrowserStartPageSearch.js';
import './start-page-search.css';

export function BrowserStartPageSearch(props: BrowserStartPageSearchProps) {
  const { translate: t } = props;
  const search = useBrowserStartPageSearch(props);
  const suggestionsId = useId();

  return <form className={`browser-start-search${search.visible ? ' is-open' : ''}`} role="search"
    aria-label={t('feature.browser.address')} aria-busy={search.busy}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) search.close(); }}
    onSubmit={(event) => { event.preventDefault(); search.submit(); }}>
    <div className="browser-start-search__surface">
      <div className="browser-start-search__row">
        <Search className="browser-start-search__icon" size={16} aria-hidden="true" />
        <TextField className="browser-start-search__input" ref={search.inputRef} value={search.query}
          role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={search.visible}
          aria-controls={search.visible ? suggestionsId : undefined}
          aria-activedescendant={search.visible ? `${suggestionsId}-${search.activeIndex}` : undefined}
          aria-label={t('feature.browser.address')} placeholder={t('feature.browser.searchPlaceholder')}
          autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go"
          onFocus={search.focus} onChange={(event) => search.change(event.currentTarget.value)}
          onCompositionStart={() => { search.composing.current = true; }}
          onCompositionEnd={() => { search.composing.current = false; }}
          onKeyDown={search.onKeyDown} />
        {search.query ? <IconButton className="browser-start-search__clear" label={t('feature.browser.clearInput')}
          onMouseDown={(event) => event.preventDefault()} onClick={search.clear}><X size={14} /></IconButton> : null}
      </div>
      {search.visible ? <BrowserStartPageSuggestions id={suggestionsId} suggestions={search.suggestions}
        activeIndex={search.activeIndex} onSelect={search.select} onNavigate={search.navigate} translate={t} /> : null}
    </div>
  </form>;
}
