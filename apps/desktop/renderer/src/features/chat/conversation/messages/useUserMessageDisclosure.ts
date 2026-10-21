import { createContext, useContext, useEffect, useRef, useState, type FocusEvent } from 'react';

// Roughly eight lines at the conversation's normal text size.
export const userMessagePreviewHeight = 192;

export const UserMessageDisclosureContext = createContext<{
  forceExpanded: boolean;
  onToggle?(element: HTMLElement, expanded: boolean): void;
}>({ forceExpanded: false });

export function useUserMessageDisclosure() {
  const { forceExpanded, onToggle } = useContext(UserMessageDisclosureContext);
  const contentRef = useRef<HTMLSpanElement>(null);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const supported = typeof ResizeObserver !== 'undefined';
  const collapsed = supported && !forceExpanded && !expanded;

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !supported) return;
    // Observe the uncapped content so wrapping/font changes remain measurable
    // while collapsed, without synchronously measuring every message on mount.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setOverflows(entry.contentRect.height > userMessagePreviewHeight);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [supported]);

  const changeExpanded = (next: boolean) => {
    if (viewportRef.current) onToggle?.(viewportRef.current, next);
    setExpanded(next);
  };
  const handleFocus = (event: FocusEvent<HTMLSpanElement>) => {
    const viewport = viewportRef.current;
    if (collapsed && viewport && event.target.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom) {
      // A keyboard-focused reference must be revealed before it can be activated.
      changeExpanded(true);
    }
  };

  return {
    collapsed,
    contentRef,
    handleFocus,
    showToggle: overflows && !forceExpanded,
    toggle: () => changeExpanded(!expanded),
    viewportRef,
  };
}
