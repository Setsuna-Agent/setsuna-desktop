import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import { pageScaleInverse } from '../../../../shared/lib/zoomedPortalPosition.js';
import { chatDisplayItemRenderKey, type ChatDisplayItem } from '../chatMessageDisplay.js';

export function chatTurnNavigationTarget(items: ChatDisplayItem[], turnId: string, hasMore: boolean): string | null {
  const prompt = items.find((item) => item.type === 'user' && item.message.turnId === turnId);
  // A loaded assistant tail may start halfway through the run. Find its prompt in
  // earlier pages before falling back to an answer whose prompt was removed.
  const target = prompt ?? (!hasMore ? items.find((item) => item.type === 'assistant' && item.turnId === turnId) : undefined);
  return target ? chatDisplayItemRenderKey(target) : null;
}

export function useChatTurnNavigation({ request, threadId, items, history, contentRef, scrollRef, onLoadOlder, onScrollToOffset }: {
  request?: ChatTurnNavigationRequest;
  threadId?: string;
  items: ChatDisplayItem[];
  history: { hasMore: boolean; loading: boolean; error: string | null };
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onLoadOlder(): void;
  onScrollToOffset(top: number, behavior: ScrollBehavior): void;
}) {
  const completedRef = useRef<string | null>(null);
  const requestKey = request ? JSON.stringify([request.threadId, request.turnId, request.requestId]) : null;
  const targetId = request ? chatTurnNavigationTarget(items, request.turnId, history.hasMore) : null;

  useLayoutEffect(() => {
    if (!requestKey) { completedRef.current = null; return; }
    if (request?.threadId !== threadId || completedRef.current === requestKey) return;
    if (!targetId) {
      if (history.hasMore && !history.loading && !history.error) onLoadOlder();
      return;
    }
    const viewport = scrollRef.current;
    const target = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])
      .find((node) => node.dataset.messageId === targetId);
    if (!viewport || !target) return;
    const top = viewport.scrollTop + (target.getBoundingClientRect().top - viewport.getBoundingClientRect().top) * pageScaleInverse();
    // Use the shared scroll owner to cancel pending bottom-follow before jumping.
    onScrollToOffset(Math.max(0, top), 'auto');
    completedRef.current = requestKey;
  }, [contentRef, history.error, history.hasMore, history.loading, onLoadOlder, onScrollToOffset, request?.threadId, requestKey, scrollRef, targetId, threadId]);
}
