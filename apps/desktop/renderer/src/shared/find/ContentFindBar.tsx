import { IconButton } from '@setsuna-desktop/renderer-ui';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';

export function ContentFindBar({
  placeholder, query, current, total, focusRequest, busy = false, pending = false,
  fallbackFocusRef, onFocusRequestConsumed, onQueryChange, onMove, onClose,
}: {
  placeholder: string;
  query: string;
  current: number;
  total: number;
  focusRequest: number;
  busy?: boolean;
  pending?: boolean;
  fallbackFocusRef: RefObject<HTMLDivElement | null>;
  onFocusRequestConsumed?(requestId: number): void;
  onQueryChange(query: string): void;
  onMove(direction: -1 | 1): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef(document.activeElement);
  const close = useCallback(() => {
    const previous = previousFocusRef.current;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    else fallbackFocusRef.current?.focus({ preventScroll: true });
    onClose();
  }, [fallbackFocusRef, onClose]);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    onFocusRequestConsumed?.(focusRequest);
  }, [focusRequest, onFocusRequestConsumed]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Several panes can keep find open; Escape belongs to the focused pane.
      const focusedBar = document.querySelector('[data-content-find-bar]:focus-within');
      if (focusedBar && !focusedBar.contains(inputRef.current)) return;
      const scope = event.target instanceof Element ? event.target.closest('[data-content-find-scope]') : null;
      if (!focusedBar && scope && scope !== inputRef.current?.closest('[data-content-find-scope]')) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [close]);

  return (
    <section className="content-find" data-content-find-bar role="search" aria-label={placeholder}
      onKeyDown={(event) => {
        if (!event.nativeEvent.isComposing && event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault();
          onMove(event.shiftKey ? -1 : 1);
        }
      }}>
      <div className="content-find__input-row">
        <Search size={14} aria-hidden="true" />
        <input ref={inputRef} value={query} placeholder={placeholder} aria-label={placeholder}
          autoComplete="off" spellCheck={false} onChange={(event) => onQueryChange(event.target.value)} />
        <IconButton label={t('common.close')} onClick={close}><X size={14} /></IconButton>
      </div>
      <div className="content-find__results-row">
        <IconButton label={t('contentFind.previous')} disabled={!total} onClick={() => onMove(-1)}><ArrowUp size={15} /></IconButton>
        <IconButton label={t('contentFind.next')} disabled={!total} onClick={() => onMove(1)}><ArrowDown size={15} /></IconButton>
        <span className="content-find__count" role="status" aria-live="polite" aria-busy={Boolean(query) && busy}>
          {query && pending ? <span className="sd-spinner" aria-label={t('common.loading')} /> : null}
          {query ? (total ? t('contentFind.results', { current, total }) : pending ? null : t('contentFind.noResults')) : null}
        </span>
      </div>
    </section>
  );
}
