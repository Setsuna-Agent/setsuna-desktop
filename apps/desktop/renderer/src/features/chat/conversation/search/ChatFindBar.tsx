import { IconButton } from '@setsuna-desktop/renderer-ui';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import type { ChatTranscriptMessageHistory } from '../ChatTranscript.js';
import { useChatFind } from './useChatFind.js';

export function ChatFindBar({ contentRef, scrollRef, focusRequest, history, onFocusRequestConsumed, onClose, onLoadOlder, onScrollToOffset }: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  focusRequest: number;
  history: ChatTranscriptMessageHistory;
  onFocusRequestConsumed?(requestId: number): void;
  onClose(): void;
  onLoadOlder(): void;
  onScrollToOffset(top: number, behavior: ScrollBehavior): void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef(document.activeElement);
  const find = useChatFind({ contentRef, scrollRef, onScrollToOffset });
  const searching = find.query.length > 0;

  useLayoutEffect(() => {
    if (!focusRequest) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    onFocusRequestConsumed?.(focusRequest);
  }, [focusRequest, onFocusRequestConsumed]);

  useEffect(() => {
    if (!searching || !history.hasMore || history.loading || history.error) return undefined;
    // Continue through the existing cursor API; closing find cancels the next
    // page, and the history owner already discards replies from another thread.
    const timer = setTimeout(onLoadOlder, 0);
    return () => clearTimeout(timer);
  }, [history.error, history.hasMore, history.loading, history.messages, onLoadOlder, searching]);

  const close = useCallback(() => {
    const previous = previousFocusRef.current;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    else scrollRef.current?.focus({ preventScroll: true });
    onClose();
  }, [onClose, scrollRef]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [close]);

  return (
    <section
      className="chat-find"
      role="search"
      aria-label={t('chat.find.placeholder')}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault();
          find.move(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <div className="chat-find__input-row">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          value={find.query}
          placeholder={t('chat.find.placeholder')}
          aria-label={t('chat.find.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => find.setQuery(event.target.value)}
        />
        <IconButton label={t('common.close')} onClick={close}><X size={14} /></IconButton>
      </div>
      <div className="chat-find__results-row">
        <IconButton label={t('chat.find.previous')} disabled={!find.total} onClick={() => find.move(-1)}><ArrowUp size={15} /></IconButton>
        <IconButton label={t('chat.find.next')} disabled={!find.total} onClick={() => find.move(1)}><ArrowDown size={15} /></IconButton>
        <span className="chat-find__count" role="status" aria-live="polite" aria-busy={searching && history.loading}>
          {searching && history.hasMore && !history.error ? <span className="sd-spinner" aria-label={t('common.loading')} /> : null}
          {searching ? (find.total ? t('chat.find.results', { current: find.current, total: find.total }) : history.hasMore && !history.error ? null : t('chat.find.noResults')) : null}
        </span>
      </div>
    </section>
  );
}
