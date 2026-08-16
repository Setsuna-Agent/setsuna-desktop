import { useLayoutEffect, useRef, type RefObject } from 'react';

type ActiveOptionScrollMetrics = {
  clientHeight: number;
  clientTop: number;
  optionBottom: number;
  optionTop: number;
  scrollHeight: number;
  scrollTop: number;
  viewportTop: number;
};

export function nextActiveOptionScrollTop(metrics: ActiveOptionScrollMetrics): number {
  const visibleTop = metrics.viewportTop + metrics.clientTop;
  const visibleBottom = visibleTop + metrics.clientHeight;
  const maximumScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);

  if (metrics.optionTop < visibleTop) {
    return Math.max(0, metrics.scrollTop - (visibleTop - metrics.optionTop));
  }
  if (metrics.optionBottom > visibleBottom) {
    return Math.min(maximumScrollTop, metrics.scrollTop + metrics.optionBottom - visibleBottom);
  }
  return metrics.scrollTop;
}

/** 将键盘导航限制在菜单内，避免滚动外层聊天视口。 */
export function useActiveOptionScroll<TContainer extends HTMLElement, TOption extends HTMLElement>(
  activeOptionKey: string | number | null | undefined,
  enabled = true,
): {
  activeOptionRef: RefObject<TOption>;
  floatingCursorRef: RefObject<HTMLDivElement>;
  scrollContainerRef: RefObject<TContainer>;
} {
  const scrollContainerRef = useRef<TContainer>(null);
  const activeOptionRef = useRef<TOption>(null);
  const floatingCursorRef = useRef<HTMLDivElement>(null);
  const floatingCursorReadyRef = useRef(false);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const option = activeOptionRef.current;
    const cursor = floatingCursorRef.current;
    /* 菜单关闭后重开时，光标应重新“无过渡”落位，而不是从旧位置飞回。 */
    if (!enabled) floatingCursorReadyRef.current = false;
    if (!enabled || !container) return;
    if (!option) {
      cursor?.classList.remove('is-visible');
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const nextScrollTop = nextActiveOptionScrollTop({
      clientHeight: container.clientHeight,
      clientTop: container.clientTop,
      optionBottom: optionRect.bottom,
      optionTop: optionRect.top,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      viewportTop: containerRect.top,
    });
    if (nextScrollTop !== container.scrollTop) container.scrollTop = nextScrollTop;

    /* 浮动高亮块跟随 active 项滑动；首次定位关闭过渡，避免从菜单顶部飞入。 */
    if (cursor && cursor.parentElement === container) {
      const placeCursor = () => {
        cursor.style.height = `${option.offsetHeight}px`;
        cursor.style.translate = `0 ${option.offsetTop}px`;
      };
      if (!floatingCursorReadyRef.current) {
        cursor.style.transition = 'none';
        placeCursor();
        void cursor.offsetHeight;
        cursor.style.transition = '';
        floatingCursorReadyRef.current = true;
      } else {
        placeCursor();
      }
      cursor.classList.add('is-visible');
    }
  }, [activeOptionKey, enabled]);

  return { activeOptionRef, floatingCursorRef, scrollContainerRef };
}
