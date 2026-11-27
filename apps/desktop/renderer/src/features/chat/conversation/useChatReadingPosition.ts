import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  chatMessageAnchorTop,
  findChatMessageAnchorTarget,
  readVisibleChatMessageAnchor,
  type ChatMessageScrollAnchor,
} from './chatHistoryScrollAnchor.js';

export type ChatReadingPositionScope = { client: object; threadId: string };

export type ChatReadingPosition = {
  top: number;
  message?: ChatMessageScrollAnchor;
  before: number;
  expandedHistory: boolean;
};

// A runtime client lives above the conversation routes in this window.
const positionsByClient = new WeakMap<object, Map<string, ChatReadingPosition>>();

export function useChatReadingPosition({
  scope,
  pendingPositionRef,
  scrollRef,
  isFollowingBottom,
  scrollToOffset,
  history,
  hasHiddenHistory,
  expandedHistory,
  revealHistory,
  requestEarlierMessages,
  navigatingToTurn,
}: {
  scope?: ChatReadingPositionScope;
  pendingPositionRef: MutableRefObject<ChatReadingPosition | undefined>;
  scrollRef: RefObject<HTMLDivElement>;
  isFollowingBottom(): boolean;
  scrollToOffset(top: number, behavior: ScrollBehavior): void;
  history: { nextBefore: number | null; loading: boolean; error: string | null };
  hasHiddenHistory: boolean;
  expandedHistory: boolean;
  revealHistory(): void;
  requestEarlierMessages(node: HTMLDivElement, expandingWindow: boolean, stopBefore: number): void;
  navigatingToTurn: boolean;
}) {
  const { client, threadId } = scope ?? {};
  const { nextBefore, loading, error } = history;
  const historyRef = useRef({ before: nextBefore ?? 0, expandedHistory });
  useLayoutEffect(() => {
    historyRef.current = { before: nextBefore ?? 0, expandedHistory };
  }, [expandedHistory, nextBefore]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!client || !threadId || !viewport) return;
    pendingPositionRef.current = positionsByClient.get(client)?.get(threadId);
    return () => {
      // A fast switch during pagination leaves the original bookmark intact.
      if (pendingPositionRef.current || !viewport.clientHeight) return;
      const positions = positionsByClient.get(client);
      if (isFollowingBottom() || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1) {
        positions?.delete(threadId);
        return;
      }
      const position = {
        ...historyRef.current,
        top: viewport.scrollTop,
        message: readVisibleChatMessageAnchor(viewport),
      };
      if (positions) positions.set(threadId, position);
      else positionsByClient.set(client, new Map([[threadId, position]]));
    };
  }, [client, isFollowingBottom, pendingPositionRef, scrollRef, threadId]);

  useLayoutEffect(() => {
    const position = pendingPositionRef.current;
    const viewport = scrollRef.current;
    if (!position || !viewport) return;
    if (navigatingToTurn) {
      pendingPositionRef.current = undefined;
      return;
    }
    const target = findChatMessageAnchorTarget(viewport, position.message);
    if (hasHiddenHistory && position.message && (!target || position.expandedHistory)) {
      revealHistory();
      return;
    }
    if (!target && position.message && nextBefore !== null && nextBefore > position.before && !error) {
      // Suspend bottom follow while the saved row is outside the current page.
      scrollToOffset(0, 'auto');
      if (!loading) requestEarlierMessages(viewport, false, position.before);
      return;
    }
    pendingPositionRef.current = undefined;
    const top = target && position.message
      ? chatMessageAnchorTop(viewport, target, position.message.offset)
      : position.top;
    scrollToOffset(Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight)), 'auto');
  }, [error, hasHiddenHistory, loading, navigatingToTurn, nextBefore, pendingPositionRef, requestEarlierMessages, revealHistory, scrollRef, scrollToOffset]);
}
