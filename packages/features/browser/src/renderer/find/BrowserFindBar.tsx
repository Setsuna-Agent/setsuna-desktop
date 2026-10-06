import { IconButton } from '@setsuna-desktop/renderer-ui';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { BrowserTranslate } from '../messages.js';
import type { BrowserFindState } from './useBrowserFind.js';
import './browser-find.css';

export function BrowserFindBar({ find, translate }: { find: BrowserFindState; translate: BrowserTranslate }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [find.focusRequest]);

  return <section className="browser-find" role="search" aria-label={translate('feature.browser.find.placeholder')}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        find.close();
      } else if (event.key === 'Enter' && event.target === inputRef.current) {
        event.preventDefault();
        find.move(!event.shiftKey);
      }
    }}>
    <Search size={14} aria-hidden="true" />
    <input ref={inputRef} value={find.query} autoComplete="off" spellCheck={false}
      aria-label={translate('feature.browser.find.placeholder')} placeholder={translate('feature.browser.find.placeholder')}
      onChange={(event) => find.changeQuery(event.target.value)} />
    <span className="browser-find__count" role="status" aria-live="polite">
      {find.query && find.result ? `${find.result.current}/${find.result.total}` : null}
    </span>
    <IconButton label={translate('feature.browser.find.previous')} disabled={!find.result?.total} onClick={() => find.move(false)}><ArrowUp size={14} /></IconButton>
    <IconButton label={translate('feature.browser.find.next')} disabled={!find.result?.total} onClick={() => find.move(true)}><ArrowDown size={14} /></IconButton>
    <IconButton label={translate('feature.browser.find.close')} onClick={() => find.close()}><X size={14} /></IconButton>
  </section>;
}
