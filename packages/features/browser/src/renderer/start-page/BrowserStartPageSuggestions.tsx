import { Button } from '@setsuna-desktop/renderer-ui';
import { Bookmark, CornerDownLeft, Globe, History, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { BrowserAddressSuggestion } from '../address-bar/browserAddressCandidates.js';
import type { BrowserTranslate } from '../messages.js';

export function BrowserStartPageSuggestions({ id, suggestions, activeIndex, onSelect, onNavigate, translate: t }: {
  id: string;
  suggestions: readonly BrowserAddressSuggestion[];
  activeIndex: number;
  onSelect(index: number): void;
  onNavigate(url: string, searchQuery?: string): void;
  translate: BrowserTranslate;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => { selected.current?.scrollIntoView?.({ block: 'nearest' }); }, [activeIndex]);

  return <div id={id} className="browser-start-search__suggestions" role="listbox"
    aria-label={t('feature.browser.addressSuggestions')}
    onMouseDown={(event) => { if (event.button === 0) event.preventDefault(); }}>
    {suggestions.map((item, index) => {
      const Icon = item.kind === 'search' ? Search : item.kind === 'navigate' ? Globe : item.kind === 'bookmark' ? Bookmark : History;
      const label = item.kind === 'search' ? t('feature.browser.suggestion.search', { query: item.title })
        : item.kind === 'navigate' ? t('feature.browser.suggestion.visit', { address: item.title }) : item.title;
      return <Button key={item.id} id={`${id}-${index}`} variant="ghost" role="option" tabIndex={-1}
        aria-selected={index === activeIndex} className="browser-start-search__suggestion"
        ref={index === activeIndex ? selected : undefined} title={item.kind === 'search' ? label : item.url}
        onMouseMove={() => onSelect(index)}
        onClick={() => onNavigate(item.url, item.kind === 'search' ? item.title : undefined)}>
        <Icon size={16} aria-hidden="true" />
        <span className="browser-start-search__suggestion-title">{label}</span>
        {item.kind === 'navigate' ? <span className="browser-start-search__suggestion-url">{item.url}</span> : null}
        <CornerDownLeft className="browser-start-search__enter" size={14} aria-hidden="true" />
      </Button>;
    })}
  </div>;
}
