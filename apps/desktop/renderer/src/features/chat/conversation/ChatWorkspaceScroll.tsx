import type { RuntimeThread } from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
} from 'react';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import type { ChatContextTokenUsage } from './chatContextUsage.js';
import {
  canFitConversationOverviewPanel,
  doesConversationOverviewOverlapContent,
  needsConversationOverviewContentShift
} from './conversationOverviewLayout.js';

const scrollBottomThresholdPx = 96;
const stickyBottomThresholdPx = 4;
const pinnedScrollSettleFrameCount = 3;
const keyboardScrollIntentKeys = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

export function ChatScrollOverlay({ disabled, scrollRef, scrollSignal }: { disabled: boolean; scrollRef: RefObject<HTMLDivElement | null>; scrollSignal: string }) {
  const dragRef = useRef<{
    scrollRange: number;
    startScrollTop: number;
    startY: number;
    thumbRange: number;
  } | null>(null);
  const [metrics, setMetrics] = useState({
    height: 0,
    thumbHeight: 0,
    thumbTop: 0,
    top: 0,
    visible: false,
  });
  const updateMetrics = useCallback(() => {
    const node = scrollRef.current;
    if (!node || disabled) {
      setMetrics((current) => (current.visible ? { height: 0, thumbHeight: 0, thumbTop: 0, top: 0, visible: false } : current));
      return;
    }
    const height = node.clientHeight;
    const scrollHeight = node.scrollHeight;
    const visible = scrollHeight > height + 1;
    const thumbHeight = visible ? Math.max(36, Math.round((height / scrollHeight) * height)) : 0;
    const thumbRange = Math.max(0, height - thumbHeight);
    const scrollRange = Math.max(0, scrollHeight - height);
    const thumbTop = scrollRange > 0 ? Math.round((node.scrollTop / scrollRange) * thumbRange) : 0;
    const next = {
      height,
      thumbHeight,
      thumbTop,
      top: node.offsetTop,
      visible,
    };
    setMetrics((current) => (current.height === next.height && current.thumbHeight === next.thumbHeight && current.thumbTop === next.thumbTop && current.top === next.top && current.visible === next.visible ? current : next));
  }, [disabled, scrollRef]);

  useLayoutEffect(() => {
    updateMetrics();
    const node = scrollRef.current;
    if (!node || disabled) return undefined;
    node.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      observer?.disconnect();
    };
  }, [disabled, scrollRef, scrollSignal, updateMetrics]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      if (!node || !metrics.visible) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        scrollRange: Math.max(0, node.scrollHeight - node.clientHeight),
        startScrollTop: node.scrollTop,
        startY: event.clientY,
        thumbRange: Math.max(1, metrics.height - metrics.thumbHeight),
      };
    },
    [metrics.height, metrics.thumbHeight, metrics.visible, scrollRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      const drag = dragRef.current;
      if (!node || !drag) return;
      const delta = event.clientY - drag.startY;
      node.scrollTop = drag.startScrollTop + (delta / drag.thumbRange) * drag.scrollRange;
    },
    [scrollRef],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!metrics.visible) return null;

  return (
    <div className="chat-scrollbar-overlay" aria-hidden="true" style={{ height: metrics.height, top: metrics.top }}>
      <div className="chat-scrollbar-overlay__thumb" style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }} onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
    </div>
  );
}

/**
 * 在用户没有主动离开底部时，让流式聊天持续吸附到底部。
 *
 * @param scrollSignal 影响滚动高度或活动状态的紧凑信号。
 * @param showEmptyStarter 当前是否处于空线程 starter 页面。
 * @param threadId 当前线程 ID，切换线程时用于重置滚动状态。
 */
export function usePinnedChatScroll({ contentRef, scrollSignal, showEmptyStarter, threadId }: { contentRef: RefObject<HTMLDivElement | null>; scrollSignal: string; showEmptyStarter: boolean; threadId: string | null }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // sticky 状态放在 ref 里，滚动事件高频触发时不需要每次 rerender。
  const shouldStickToBottomRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  // token 递增会让已排队的 animation-frame 滚动失效，用于线程切换或用户手势打断。
  const scrollScheduleTokenRef = useRef(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const scrollDistanceToBottom = useCallback((node: HTMLDivElement) => Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight), []);
  const cancelScheduledScroll = useCallback(() => {
    // 先递增 token，再 cancel frame，覆盖已经进入回调队列但尚未执行的情况。
    scrollScheduleTokenRef.current += 1;
    if (scrollFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = null;
  }, []);
  const scrollToBottomNow = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setShowScrollBottom(false);
  }, []);
  const schedulePinnedScroll = useCallback(
    (frameCount = pinnedScrollSettleFrameCount) => {
      if (showEmptyStarter || !shouldStickToBottomRef.current) return;
      if (typeof window === 'undefined') {
        scrollToBottomNow();
        return;
      }

      // 流式 Markdown 和工具面板可能连续几帧增高，多帧 settle 可以避免滚动少一截。
      const token = scrollScheduleTokenRef.current + 1;
      scrollScheduleTokenRef.current = token;
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);

      const tick = (remainingFrames: number) => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (token !== scrollScheduleTokenRef.current) return;
          scrollFrameRef.current = null;
          if (!shouldStickToBottomRef.current) return;
          scrollToBottomNow();
          if (remainingFrames > 1) tick(remainingFrames - 1);
        });
      };

      tick(Math.max(1, frameCount));
    },
    [scrollToBottomNow, showEmptyStarter],
  );

  const syncScrollBottomState = useCallback(() => {
    const node = scrollRef.current;
    if (!node || showEmptyStarter) {
      setShowScrollBottom(false);
      return;
    }

    const distanceToBottom = scrollDistanceToBottom(node);
    const atBottom = distanceToBottom <= stickyBottomThresholdPx;
    if (atBottom) {
      // 回到底部后重新进入 sticky 模式，后续流式内容继续自动跟随。
      userScrollIntentRef.current = false;
      shouldStickToBottomRef.current = true;
      setShowScrollBottom(false);
      return;
    }

    const nearBottom = distanceToBottom <= scrollBottomThresholdPx;
    // Resize 和程序滚动也会触发 scroll；只有明确用户手势才允许解除 sticky。
    if (userScrollIntentRef.current) {
      shouldStickToBottomRef.current = false;
      setShowScrollBottom(!nearBottom);
      return;
    }

    if (shouldStickToBottomRef.current) {
      setShowScrollBottom(false);
      schedulePinnedScroll(1);
      return;
    }

    setShowScrollBottom(true);
  }, [schedulePinnedScroll, scrollDistanceToBottom, showEmptyStarter]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const node = scrollRef.current;
      if (!node) return;
      userScrollIntentRef.current = false;
      shouldStickToBottomRef.current = true;
      setShowScrollBottom(false);
      node.scrollTo({ top: node.scrollHeight, behavior });
      if (behavior === 'auto') schedulePinnedScroll(2);
    },
    [schedulePinnedScroll],
  );

  const markUserScrollIntent = useCallback(() => {
    if (!showEmptyStarter) userScrollIntentRef.current = true;
  }, [showEmptyStarter]);

  const releasePinnedScrollForUser = useCallback(() => {
    if (showEmptyStarter) return;
    cancelScheduledScroll();
    // 用户主动滚动后保持当前位置，直到用户点击“滚动到底部”或真的回到底部。
    userScrollIntentRef.current = true;
    shouldStickToBottomRef.current = false;
    const node = scrollRef.current;
    if (!node) return;
    setShowScrollBottom(scrollDistanceToBottom(node) > scrollBottomThresholdPx);
  }, [cancelScheduledScroll, scrollDistanceToBottom, showEmptyStarter]);

  const handleScrollWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (showEmptyStarter) return;
      const node = scrollRef.current;
      if (!node) return;
      const distanceToBottom = scrollDistanceToBottom(node);
      if (event.deltaY < 0 || distanceToBottom > stickyBottomThresholdPx) {
        releasePinnedScrollForUser();
        return;
      }
      markUserScrollIntent();
    },
    [markUserScrollIntent, releasePinnedScrollForUser, scrollDistanceToBottom, showEmptyStarter],
  );

  const handleScrollTouchMove = useCallback(
    (_event: ReactTouchEvent<HTMLDivElement>) => {
      releasePinnedScrollForUser();
    },
    [releasePinnedScrollForUser],
  );

  const handleScrollKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardScrollIntentKeys.has(event.key)) return;
      if (event.key === 'End') {
        markUserScrollIntent();
        return;
      }
      releasePinnedScrollForUser();
    },
    [markUserScrollIntent, releasePinnedScrollForUser],
  );

  const markScrollbarDragIntent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      if (!node || node.scrollHeight <= node.clientHeight || showEmptyStarter) return;
      const scrollbarHitWidth = Math.max(12, node.offsetWidth - node.clientWidth);
      const { right } = node.getBoundingClientRect();
      // 只在点击滚动条轨道区域时认为是拖拽意图，普通内容点击不解除 sticky。
      if (event.clientX >= right - scrollbarHitWidth) {
        releasePinnedScrollForUser();
      }
    },
    [releasePinnedScrollForUser, showEmptyStarter],
  );

  useLayoutEffect(() => {
    cancelScheduledScroll();
    userScrollIntentRef.current = false;
    const node = scrollRef.current;
    if (!node) return;
    if (showEmptyStarter) {
      // starter 页面没有 transcript，滚动位置固定在顶部，避免 composer 被强行贴底。
      node.scrollTop = 0;
      shouldStickToBottomRef.current = false;
      setShowScrollBottom(false);
      return;
    }
    shouldStickToBottomRef.current = true;
    schedulePinnedScroll();
  }, [cancelScheduledScroll, schedulePinnedScroll, showEmptyStarter, threadId]);

  useLayoutEffect(() => {
    if (showEmptyStarter) return;
    if (shouldStickToBottomRef.current) {
      schedulePinnedScroll();
    } else {
      syncScrollBottomState();
    }
  }, [schedulePinnedScroll, scrollSignal, showEmptyStarter, syncScrollBottomState]);

  useLayoutEffect(() => {
    const contentNode = contentRef.current;
    const listNode = listRef.current;
    const scrollNode = scrollRef.current;
    if (!scrollNode || showEmptyStarter || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      // 监听内容和容器尺寸变化，覆盖图片/代码块/工具面板异步撑高的情况。
      if (shouldStickToBottomRef.current) {
        schedulePinnedScroll();
      } else {
        syncScrollBottomState();
      }
    });
    if (contentNode) observer.observe(contentNode);
    if (listNode && listNode !== contentNode) observer.observe(listNode);
    observer.observe(scrollNode);
    return () => observer.disconnect();
  }, [schedulePinnedScroll, scrollSignal, showEmptyStarter, syncScrollBottomState]);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    contentRef,
    handleScroll: syncScrollBottomState,
    handleScrollKeyDown,
    handleScrollTouchMove,
    handleScrollWheel,
    listRef,
    markScrollbarDragIntent,
    scrollRef,
    scrollToBottom,
    showScrollBottom,
  };
}

export function useConversationOverviewAutoExpand(conversationRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>): { canExpand: boolean; needsContentShift: boolean } {
  const [layout, setLayout] = useState(() => ({ canExpand: false, needsContentShift: false }));

  useLayoutEffect(() => {
    const conversationNode = conversationRef.current;
    const contentNode = contentRef.current;
    if (!conversationNode || !contentNode || typeof window === 'undefined') return undefined;

    const sync = () => {
      const conversationWidth = conversationNode.getBoundingClientRect().width;
      const contentWidth = contentNode.getBoundingClientRect().width;
      const nextLayout = {
        canExpand: canFitConversationOverviewPanel({ conversationWidth, contentWidth }),
        needsContentShift: needsConversationOverviewContentShift({ conversationWidth, contentWidth }),
      };
      setLayout((current) => (current.canExpand === nextLayout.canExpand && current.needsContentShift === nextLayout.needsContentShift ? current : nextLayout));
    };
    sync();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }

    const observer = new ResizeObserver(sync);
    observer.observe(conversationNode);
    observer.observe(contentNode);
    return () => observer.disconnect();
  }, [conversationRef, contentRef]);

  return layout;
}

export function useConversationOverviewContentCollision(
  conversationRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  overviewRef: RefObject<HTMLElement | null>,
  active: boolean,
): boolean {
  const [overlapsContent, setOverlapsContent] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      setOverlapsContent(false);
      return undefined;
    }

    const conversationNode = conversationRef.current;
    const contentNode = contentRef.current;
    const overviewNode = overviewRef.current;
    if (!conversationNode || !contentNode || !overviewNode || typeof window === 'undefined') {
      setOverlapsContent(false);
      return undefined;
    }

    const sync = () => {
      const nextValue = doesConversationOverviewOverlapContent({
        conversationWidth: conversationNode.getBoundingClientRect().width,
        contentWidth: contentNode.getBoundingClientRect().width,
        overviewWidth: overviewNode.getBoundingClientRect().width,
      });
      setOverlapsContent((current) => (current === nextValue ? current : nextValue));
    };
    sync();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }

    const observer = new ResizeObserver(sync);
    observer.observe(conversationNode);
    observer.observe(contentNode);
    observer.observe(overviewNode);
    return () => observer.disconnect();
  }, [active, contentRef, conversationRef, overviewRef]);

  return overlapsContent;
}

export function conversationOverviewContextLabel(
  usage: ChatContextTokenUsage,
  compactionStatus: NonNullable<RuntimeThread['contextCompaction']>['status'] | undefined,
  t: Translate,
): string {
  if (compactionStatus === 'running') return t('conversation.overview.context.compacting');
  const percent = usage.visiblePercent || usage.percent;
  if (percent > 0) return `${formatPercent(percent)}%`;
  return t('conversation.overview.context.ready');
}

function formatPercent(value: number): string {
  const safeValue = Math.min(100, Math.max(0, value));
  return safeValue > 0 && safeValue < 1 ? safeValue.toFixed(1) : safeValue.toFixed(0);
}
