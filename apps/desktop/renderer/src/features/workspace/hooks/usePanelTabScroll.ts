import { useCallback, useEffect, useState, type RefObject } from 'react';

const SCROLL_EDGE_TOLERANCE = 1;
// Matches the overlaid buttons in panel-chrome.css.
const SCROLL_CONTROL_WIDTH = 28;

/** Keeps overflow controls in sync with tab changes, animations and panel resizing. */
export function usePanelTabScroll(
  tabsRef: RefObject<HTMLSpanElement | null>,
  activeId: string,
  tabOrderKey: string,
  dragging: boolean,
) {
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
    const position = Math.max(0, Math.min(max, tabs.scrollLeft));
    const next = {
      left: position > SCROLL_EDGE_TOLERANCE,
      right: position < max - SCROLL_EDGE_TOLERANCE,
    };
    setEdges((current) => current.left === next.left && current.right === next.right ? current : next);
  }, [tabsRef]);

  const revealActiveTab = useCallback(() => {
    const tabs = tabsRef.current;
    if (!tabs || !tabs.clientWidth || dragging) return;
    const active = Array.from(tabs.querySelectorAll<HTMLElement>('[data-desktop-panel-tab-id]'))
      .find((tab) => tab.dataset.desktopPanelTabId === activeId);
    if (!active) return;
    const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
    const position = Math.max(0, Math.min(max, tabs.scrollLeft));
    const left = position + (position > SCROLL_EDGE_TOLERANCE ? SCROLL_CONTROL_WIDTH : 0);
    const right = position + tabs.clientWidth - (position < max - SCROLL_EDGE_TOLERANCE ? SCROLL_CONTROL_WIDTH : 0);
    const end = active.offsetLeft + active.offsetWidth;
    const delta = active.offsetLeft < left ? active.offsetLeft - left : end > right ? end - right : 0;
    // Only move the tab strip; scrollIntoView can also shift the surrounding page.
    if (delta) tabs.scrollLeft = Math.max(0, Math.min(max, position + delta));
  }, [activeId, dragging, tabsRef]);

  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const update = () => {
      revealActiveTab();
      measure();
    };
    const observer = new ResizeObserver(update);
    observer.observe(tabs);
    // The viewport can stay the same size while its children enter or leave.
    for (const tab of tabs.children) observer.observe(tab);
    tabs.addEventListener('scroll', measure, { passive: true });
    update();
    return () => {
      observer.disconnect();
      tabs.removeEventListener('scroll', measure);
    };
  }, [measure, revealActiveTab, tabOrderKey, tabsRef]);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const tab = tabs.querySelector<HTMLElement>('[data-desktop-panel-tab-id]');
    if (!tab) return;
    const gap = Number.parseFloat(getComputedStyle(tabs).columnGap) || 0;
    tabs.scrollBy({
      left: direction * (tab.offsetWidth + gap),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [tabsRef]);

  return { canScrollLeft: edges.left, canScrollRight: edges.right, scrollTabs };
}
