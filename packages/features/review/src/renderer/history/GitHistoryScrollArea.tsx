import { useRef, type HTMLAttributes, type RefObject } from 'react';
import { useReviewRendererHost } from '../host.js';

export function GitHistoryScrollArea({ children, className = '', scrollRef, onScroll }: {
  scrollRef?: RefObject<HTMLDivElement>;
} & Pick<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'onScroll'>) {
  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? localRef;
  const { ui: { ScrollOverlay } } = useReviewRendererHost();
  return (
    <div className="git-history-scroll-area">
      <div className={'git-history-scroll-area__viewport ' + className} ref={viewportRef} onScroll={onScroll}>
        {/* A single content root lets the overlay observe the full list as groups resize. */}
        <div className="git-history-scroll-area__content">{children}</div>
      </div>
      <ScrollOverlay scrollRef={viewportRef} />
    </div>
  );
}
