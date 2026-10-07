import { Button, IconButton, MenuSurface } from '@setsuna-desktop/renderer-ui';
import { Search, X } from 'lucide-react';
import { BrowserFavoritesIcon, BrowserHistoryIcon } from '../records/recordIcons.js';
import { useEffect, useRef } from 'react';
import { BrowserFeatureIcon } from '../BrowserFeatureIcon.js';
import type { BrowserTranslate } from '../messages.js';
import type { BrowserAddressSuggestion } from './browserAddressCandidates.js';

export function BrowserAddressSuggestions({ activeIndex, id, onNavigate, onRemove, onSelect, suggestions, translate }: {
  activeIndex: number;
  id: string;
  onNavigate: (url: string) => void;
  onRemove: (url: string) => void;
  onSelect: (index: number) => void;
  suggestions: readonly BrowserAddressSuggestion[];
  translate: BrowserTranslate;
}) {
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <MenuSurface
      aria-label={translate('feature.browser.addressSuggestions')}
      className="desktop-browser-address-suggestions"
      id={id}
      role="grid"
      onMouseDown={(event) => { if (event.button === 0) event.preventDefault(); }}
    >
      {suggestions.map((item, index) => (
        <div
          aria-selected={index === activeIndex}
          className="desktop-browser-address-suggestions__row"
          id={`${id}-${index}`}
          key={item.id}
          ref={index === activeIndex ? selectedRef : undefined}
          role="row"
          onMouseMove={() => onSelect(index)}
        >
          <div className="desktop-browser-address-suggestions__destination" role="gridcell">
            <Button variant="ghost" className="desktop-browser-address-suggestions__link" tabIndex={-1} onClick={() => onNavigate(item.url)}>
              {item.kind === 'search' ? <Search size={14} aria-hidden="true" />
                : item.kind === 'bookmark' ? <BrowserFavoritesIcon size={14} role="img" aria-label={translate('feature.browser.bookmarksTitle')} />
                  : item.kind === 'history' ? <BrowserHistoryIcon size={14} aria-hidden="true" /> : <BrowserFeatureIcon size={14} />}
              <span className="desktop-browser-address-suggestions__text">
                <span className="desktop-browser-address-suggestions__title">{item.title}</span>
                {item.kind === 'history' || item.kind === 'bookmark' ? <span className="desktop-browser-address-suggestions__url"> — {item.url}</span> : null}
              </span>
              {item.kind === 'search' ? <span className="desktop-browser-address-suggestions__search">{translate('feature.browser.searchWeb')}</span> : null}
            </Button>
          </div>
          <div role="gridcell">
            {item.kind === 'history' ? (
              <IconButton
                className="desktop-browser-address-suggestions__remove"
                label={`${translate('feature.browser.historyDelete')} ${item.title}`}
                title={translate('feature.browser.historyDelete')}
                tabIndex={-1}
                onClick={() => onRemove(item.url)}
              ><X size={13} /></IconButton>
            ) : null}
          </div>
        </div>
      ))}
    </MenuSurface>
  );
}
