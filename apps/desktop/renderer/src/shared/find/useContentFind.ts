import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useContentFindHighlights } from './contentFindHighlights.js';
import { findContentTextRanges } from './contentFindRanges.js';
import { compareContentFindElements, contentFindNodeKey, type ContentFindMatch, type ContentFindSource } from './contentFindSources.js';

const noSources: readonly ContentFindSource[] = [];
const observerOptions: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ['hidden', 'aria-hidden', 'open', 'class', 'style'],
};

export function useContentFind({ contentRef, onRevealRange, sources = noSources }: {
  contentRef: RefObject<HTMLDivElement | null>;
  onRevealRange(range: Range): void;
  sources?: readonly ContentFindSource[];
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ current: 0, total: 0 });
  const matchesRef = useRef<ContentFindMatch[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const activeIndexRef = useRef(-1);
  const pendingRevealRef = useRef<string | null>(null);
  const previousQueryRef = useRef<string | null>(null);
  const publish = useContentFindHighlights();

  const select = useCallback((index: number, scroll: boolean) => {
    const matches = matchesRef.current;
    const match = matches[index];
    activeKeyRef.current = match?.key ?? null;
    activeIndexRef.current = match ? index : -1;
    if (scroll) pendingRevealRef.current = match?.key ?? null;
    if (match && pendingRevealRef.current === match.key) {
      match.reveal?.();
      const range = match.getRanges()[0];
      if (range) {
        onRevealRange(range);
        pendingRevealRef.current = null;
      }
    }
    publish(matches.flatMap((item) => item.getRanges()), match?.getRanges() ?? []);
    setResult((current) => current.current === index + 1 && current.total === matches.length
      ? current : { current: index + 1, total: matches.length });
  }, [onRevealRange, publish]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer === undefined) timer = setTimeout(() => refresh(), 100);
    });
    const refresh = (reset = false) => {
      timer = undefined;
      observer.disconnect();
      observer.observe(content, observerOptions);
      const visibleSources = sources.filter((source) => content.contains(source.element) && isContentFindVisible(source.element, content));
      const ranges = findContentTextRanges(content, query, {
        onShadowRoot: (root) => observer.observe(root, observerOptions),
        skipShadowRoot: (host) => visibleSources.some((source) => source.element === host || source.element.contains(host)),
      });
      const matches: ContentFindMatch[] = ranges.map((range) => ({
        key: `${contentFindNodeKey(range.startContainer)}:${range.startOffset}`,
        element: range.startContainer.parentElement!,
        getRanges: () => [range],
      }));
      for (const source of visibleSources) {
        for (const match of source.find(query)) matches.push(match);
      }
      matches.sort((a, b) => compareContentFindElements(a.element, b.element));
      matchesRef.current = matches;
      const preserved = reset ? -1 : matches.findIndex((match) => match.key === activeKeyRef.current);
      const index = preserved >= 0 ? preserved
        : Math.min(reset ? 0 : Math.max(0, activeIndexRef.current), matches.length - 1);
      // Streaming and virtualization repaint highlights without taking over reading.
      select(index, reset || (activeKeyRef.current === null && matches.length > 0));
    };
    const reset = previousQueryRef.current !== query;
    previousQueryRef.current = query;
    refresh(reset);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [contentRef, query, select, sources]);

  const move = useCallback((direction: -1 | 1) => {
    const count = matchesRef.current.length;
    if (count) select((activeIndexRef.current + direction + count) % count, true);
  }, [select]);

  return { query, setQuery, ...result, move };
}

function isContentFindVisible(element: HTMLElement, boundary: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return true;
}
