import { useEffect, type RefObject } from 'react';
import { ContentFindBar } from '../../../../shared/find/ContentFindBar.js';
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
  const find = useChatFind({ contentRef, scrollRef, onScrollToOffset });
  const searching = find.query.length > 0;

  useEffect(() => {
    if (!searching || !history.hasMore || history.loading || history.error) return undefined;
    // Continue through the existing cursor API; closing find cancels the next
    // page, and the history owner already discards replies from another thread.
    const timer = setTimeout(onLoadOlder, 0);
    return () => clearTimeout(timer);
  }, [history.error, history.hasMore, history.loading, history.messages, onLoadOlder, searching]);

  return <ContentFindBar placeholder={t('chat.find.placeholder')}
    query={find.query} current={find.current} total={find.total} onQueryChange={find.setQuery} onMove={find.move}
    focusRequest={focusRequest} fallbackFocusRef={scrollRef} onClose={onClose}
    onFocusRequestConsumed={onFocusRequestConsumed} busy={history.loading} pending={history.hasMore && !history.error} />;
}
