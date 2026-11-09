import { useCallback, useEffect, type RefObject } from 'react';
import { useContentFind } from '../../../../shared/find/useContentFind.js';
import { composedParent } from '../../../../shared/find/revealContentFindRange.js';
import { pageScaleInverse } from '../../../../shared/lib/zoomedPortalPosition.js';

export function useChatFind({ contentRef, scrollRef, onScrollToOffset }: {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollToOffset(top: number, behavior: ScrollBehavior): void;
}) {
  const onRevealRange = useCallback((range: Range) => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const rect = range.getBoundingClientRect();
    const top = viewport.scrollTop + (rect.top - viewport.getBoundingClientRect().top) * pageScaleInverse();
    onScrollToOffset(Math.max(0, top - viewport.clientHeight / 2), 'auto');
    let element = range.startContainer.parentElement;
    while (element && element !== viewport) {
      const bounds = element.getBoundingClientRect();
      if (element.scrollWidth > element.clientWidth && (rect.left < bounds.left || rect.right > bounds.right)) {
        element.scrollLeft += (rect.left - bounds.left) * pageScaleInverse() - element.clientWidth / 2;
      }
      element = composedParent(element);
    }
  }, [onScrollToOffset, scrollRef]);
  const find = useContentFind({ contentRef, onRevealRange });

  // Opening find explicitly leaves streaming follow, even before a query matches.
  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) onScrollToOffset(viewport.scrollTop, 'auto');
  }, [onScrollToOffset, scrollRef]);

  return find;
}
