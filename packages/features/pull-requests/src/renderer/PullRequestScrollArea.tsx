import { useRef, type HTMLAttributes, type RefObject } from 'react';
import { usePullRequestsHost } from './context.js';

type Props = Pick<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'onScroll' | 'aria-label'> & {
  contentClassName?: string;
  scrollRef?: RefObject<HTMLDivElement>;
  scrollable?: boolean;
};

/** Keep native scrolling while the shared scrollbar floats above symmetric content insets. */
export function PullRequestScrollArea({ children, className = '', contentClassName = '', scrollRef, scrollable = true, ...viewportProps }: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? localRef;
  const { ScrollOverlay } = usePullRequestsHost();
  return <div className={`pr-scroll-area ${className}${scrollable ? '' : ' pr-scroll-area--static'}`}>
    <div className="pr-scroll-area__viewport" ref={viewportRef} {...viewportProps}>
      {/* Observing one content root also catches pagination, expanded folders and async patches. */}
      <div className={`pr-scroll-area__content ${contentClassName}`}>{children}</div>
    </div>
    <ScrollOverlay scrollRef={viewportRef} disabled={!scrollable} />
  </div>;
}
