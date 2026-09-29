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
  scrollContainerRef: RefObject<TContainer>;
} {
  const scrollContainerRef = useRef<TContainer>(null);
  const activeOptionRef = useRef<TOption>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const option = activeOptionRef.current;
    if (!enabled || !container || !option) return;

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
  }, [activeOptionKey, enabled]);

  return { activeOptionRef, scrollContainerRef };
}
