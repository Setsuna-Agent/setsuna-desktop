import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** A stable window layer follows the visible tab's slot without moving the guest DOM. */
export function useBrowserExtensionPanelPosition(slotRef?: RefObject<HTMLDivElement | null>): CSSProperties {
  const [bounds, setBounds] = useState({ left: 0, top: 0, height: 720 });
  useLayoutEffect(() => {
    const slot = slotRef?.current;
    if (!slot) return;
    const measure = () => {
      const { left, top, height } = slot.getBoundingClientRect();
      if (height <= 0) return;
      const container = slot.parentElement;
      // DOMRects include the desktop's body zoom; fixed-position styles use its CSS pixels.
      const scale = container && container.offsetWidth > 0 ? container.getBoundingClientRect().width / container.offsetWidth : 1;
      const next = { left: left / scale, top: top / scale, height: height / scale };
      setBounds((previous) => previous.left === next.left && previous.top === next.top && previous.height === next.height
        ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    if (slot.parentElement) observer.observe(slot.parentElement);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // Floating workspace panels can move without resizing their contents.
    window.addEventListener('pointermove', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('pointermove', measure);
    };
  }, [slotRef]);
  return bounds;
}
