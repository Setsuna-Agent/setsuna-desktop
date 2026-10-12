import { IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import { BrowserFeatureIcon } from '../BrowserFeatureIcon.js';
import { browserSearchUrl } from '../browserNavigation.js';
import type { BrowserTranslate } from '../messages.js';
import './start-page-search.css';

export function BrowserStartPageSearch({ bridge, onNavigate, onError, translate: t }: {
  bridge: Pick<BrowserDesktopBridge, 'getBrowserPreferences'> | null;
  onNavigate(url: string): void;
  onError(message: string): void;
  translate: BrowserTranslate;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const composing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async () => {
    const value = query.trim();
    if (!value || composing.current || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (!bridge) throw new Error('Browser unavailable.');
      // Read on submission: always use the current engine without adding startup work.
      const { searchEngine } = await bridge.getBrowserPreferences();
      if (mounted.current) onNavigate(browserSearchUrl(value, searchEngine));
    } catch { if (mounted.current) onError(t('feature.browser.searchFailed')); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <form className="browser-start-search" role="search" aria-label={t('feature.browser.searchWeb')}
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <BrowserFeatureIcon className="browser-start-search__icon" size={18} aria-hidden="true" />
    <TextField type="search" className="browser-start-search__input" value={query}
      aria-label={t('feature.browser.searchWeb')} placeholder={t('feature.browser.searchPlaceholder')}
      autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
      onChange={(event) => setQuery(event.currentTarget.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
          event.preventDefault();
        }
      }} />
    <IconButton type="submit" className="browser-start-search__submit" label={t('feature.browser.searchWeb')}
      disabled={busy || !query.trim()} aria-busy={busy}><Search size={19} /></IconButton>
  </form>;
}
