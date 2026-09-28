import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { pageScaleInverse } from '../../../../shared/lib/zoomedPortalPosition.js';
import { findChatTextRanges } from './chatFindMatches.js';

const matchesHighlightName = 'content-find-match';
const activeHighlightName = 'content-find-active';
const observerOptions: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ['hidden', 'aria-hidden', 'open', 'class', 'style'],
};

export function useChatFind({ contentRef, scrollRef, onScrollToOffset }: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollToOffset(top: number, behavior: ScrollBehavior): void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ current: 0, total: 0 });
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(-1);
  const anchorRef = useRef<{ node: Node; offset: number } | null>(null);

  const select = useCallback((index: number, scroll: boolean) => {
    const ranges = rangesRef.current;
    const range = ranges[index];
    activeIndexRef.current = range ? index : -1;
    anchorRef.current = range ? { node: range.startContainer, offset: range.startOffset } : null;
    const highlight = new Highlight(...(range ? [range] : []));
    highlight.priority = 1;
    CSS.highlights.set(activeHighlightName, highlight);
    setResult((current) => current.current === index + 1 && current.total === ranges.length
      ? current : { current: index + 1, total: ranges.length });
    const viewport = scrollRef.current;
    if (scroll && range && viewport) {
      const rect = range.getBoundingClientRect();
      const top = viewport.scrollTop + (rect.top - viewport.getBoundingClientRect().top) * pageScaleInverse();
      onScrollToOffset(Math.max(0, top - viewport.clientHeight / 2), 'auto');
      // Long code lines can have their own horizontal viewport inside a shadow root.
      let element = range.startContainer.parentElement;
      while (element && element !== viewport) {
        const bounds = element.getBoundingClientRect();
        if (element.scrollWidth > element.clientWidth && (rect.left < bounds.left || rect.right > bounds.right)) {
          element.scrollLeft += (rect.left - bounds.left) * pageScaleInverse() - element.clientWidth / 2;
        }
        const root = element.getRootNode();
        element = element.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null);
      }
    }
  }, [onScrollToOffset, scrollRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer === undefined) timer = setTimeout(() => refresh(), 100);
    });
    const refresh = (reset = false) => {
      timer = undefined;
      const anchor = reset ? null : anchorRef.current;
      observer.disconnect();
      observer.observe(content, observerOptions);
      const ranges = findChatTextRanges(content, query, (root) => observer.observe(root, observerOptions));
      rangesRef.current = ranges;
      const highlight = new Highlight();
      for (const range of ranges) highlight.add(range);
      CSS.highlights.set(matchesHighlightName, highlight);
      const preserved = anchor ? ranges.findIndex((range) => (
        range.startContainer === anchor.node && range.startOffset === anchor.offset
      )) : -1;
      const index = preserved >= 0 ? preserved
        : Math.min(reset ? 0 : Math.max(0, activeIndexRef.current), ranges.length - 1);
      // Streaming and prepended history update the count without repeatedly
      // dragging the viewport away from the user's reading position.
      select(index, reset || (!anchor && ranges.length > 0));
    };
    refresh(true);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      CSS.highlights.delete(matchesHighlightName);
      CSS.highlights.delete(activeHighlightName);
      rangesRef.current = [];
      anchorRef.current = null;
    };
  }, [contentRef, query, select]);

  const move = useCallback((direction: -1 | 1) => {
    const count = rangesRef.current.length;
    if (count) select((activeIndexRef.current + direction + count) % count, true);
  }, [select]);

  // Opening find explicitly leaves streaming follow, even before a query matches.
  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) onScrollToOffset(viewport.scrollTop, 'auto');
  }, [onScrollToOffset, scrollRef]);

  return { query, setQuery, ...result, move };
}
