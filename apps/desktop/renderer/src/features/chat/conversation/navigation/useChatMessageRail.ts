import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { pageScaleInverse } from '../../../../shared/lib/zoomedPortalPosition.js';
import { activeChatMessageIndex, chatMessageReadingRange, type ChatMessageNavigationItem, type ChatMessagePosition } from './chatMessageNavigation.js';

export function useChatMessageRail({ items, scrollRef, contentRef }: {
  items: ChatMessageNavigationItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const identity = JSON.stringify(items.map((item) => item.id));
  const ids = useMemo<string[]>(() => JSON.parse(identity), [identity]);
  const targetsRef = useRef(new Map<string, HTMLElement>());
  const [layout, setLayout] = useState({
    activeIndex: 0, readingStart: 0, readingEnd: 0, height: 0, top: 0, width: 0,
    pixelScale: 1, pixelTop: 0, visible: false,
  });

  const measure = useCallback(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return null;
    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const viewportTop = viewportRect.top;
    const inverse = pageScaleInverse();
    const style = window.getComputedStyle(viewport);
    const requiredGutter = ['inset', 'width', 'gap'].reduce((total, part) => (
      total + Number.parseFloat(style.getPropertyValue(`--chat-message-rail-${part}`))
    ), 0);
    // Transforms do not trigger ResizeObserver. Keep the rail out of moving content,
    // then compare the settled bounds in unscaled CSS pixels against the hit area.
    const moving = content.getAnimations?.().some((animation) => animation.playState === 'running'
      && 'transitionProperty' in animation && animation.transitionProperty === 'transform') ?? false;
    const hasGutter = !moving && viewportRect.width > 0 && contentRect.width > 0
      && Number.isFinite(requiredGutter) && requiredGutter > 0
      && (contentRect.left - viewportRect.left) * inverse >= requiredGutter;
    const positions: ChatMessagePosition[] = ids.flatMap((id) => {
      const target = targetsRef.current.get(id);
      if (!target) return [];
      const rect = target.getBoundingClientRect();
      return [{ id, top: viewport.scrollTop + (rect.top - viewportTop) * inverse, height: rect.height * inverse }];
    });
    return {
      positions,
      hasGutter,
      pixelScale: window.devicePixelRatio / inverse,
      pixelTop: viewportTop * window.devicePixelRatio,
    };
  }, [contentRef, ids, scrollRef]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;
    targetsRef.current = new Map(Array.from(content.querySelectorAll<HTMLElement>('[data-message-id]'))
      .map((node) => [node.dataset.messageId!, node]));
    let frame: number | null = null;
    const sync = () => {
      frame = null;
      const measured = measure();
      if (!measured) return;
      const { positions, hasGutter, pixelScale, pixelTop } = measured;
      const readingRange = chatMessageReadingRange(positions, viewport.scrollTop, viewport.clientHeight);
      const next = {
        activeIndex: activeChatMessageIndex(positions, viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight),
        readingStart: readingRange.start,
        readingEnd: readingRange.end,
        height: viewport.clientHeight,
        top: viewport.offsetTop,
        width: viewport.clientWidth,
        pixelScale,
        pixelTop,
        visible: hasGutter && positions.length > 1 && viewport.clientHeight > 0 && viewport.scrollHeight > viewport.clientHeight + 1,
      };
      setLayout((current) => current.activeIndex === next.activeIndex && current.height === next.height
        && current.readingStart === next.readingStart && current.readingEnd === next.readingEnd
        && current.pixelScale === next.pixelScale && current.pixelTop === next.pixelTop
        && current.top === next.top && current.width === next.width && current.visible === next.visible ? current : next);
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(sync);
    };
    const onTransition = (event: TransitionEvent) => {
      if (event.target === content && event.propertyName === 'transform') schedule();
    };
    sync();
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(content);
    // Expanding one message can move another without changing the total content height.
    for (const target of targetsRef.current.values()) observer.observe(target);
    // Overview placement can change without resizing either observed box, including
    // when reduced motion makes the transform change instantaneously.
    const placementObserver = new MutationObserver(schedule);
    if (viewport.parentElement) placementObserver.observe(viewport.parentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    const transitionEvents = ['transitionrun', 'transitionend', 'transitioncancel'] as const;
    for (const event of transitionEvents) content.addEventListener(event, onTransition);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      placementObserver.disconnect();
      for (const event of transitionEvents) content.removeEventListener(event, onTransition);
    };
  }, [contentRef, measure, scrollRef]);

  const messageOffset = useCallback((id: string): number | null => {
    const viewport = scrollRef.current;
    const position = measure()?.positions.find((entry) => entry.id === id);
    if (!viewport || !position) return null;
    return Math.max(0, position.top - Math.max(0, (viewport.clientHeight - position.height) / 2));
  }, [measure, scrollRef]);

  return { layout, messageOffset };
}
