import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { BrowserAnnotationAnchor, BrowserAnnotationTarget, BrowserDesktopBridge } from '../../contracts/index.js';

export type AnnotationViewportRef = RefObject<{ getBoundingClientRect(): DOMRect } | null>;

/** Convert guest CSS pixels through the actual webview viewport, including zoom/device scaling. */
export function useAnnotationPopoverPosition({ bridge, tabId, target, enabled, surfaceRef, webviewRef }: {
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  target: BrowserAnnotationTarget | null;
  enabled: boolean;
  surfaceRef: RefObject<HTMLDivElement>;
  webviewRef: AnnotationViewportRef;
}) {
  const ref = useRef<HTMLElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const popover = ref.current;
    if (!enabled || !surface || !popover || !target) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anchor: BrowserAnnotationAnchor | null = target;

    const position = () => {
      if (disposed) return;
      const container = surface.getBoundingClientRect();
      const guest = webviewRef.current?.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const padding = 12;
      const gap = 14;
      // Keep the dock usable while editing, even when the selected element fills the page.
      const bottom = container.height - 68;
      const clampX = (x: number) => Math.max(padding, Math.min(x, container.width - width - padding));
      const clampY = (y: number) => Math.max(padding, Math.min(y, bottom - height));
      let left = container.width - width - padding;
      let top = bottom - height;
      if (anchor && guest && anchor.viewport.width > 0 && anchor.viewport.height > 0) {
        const scaleX = guest.width / anchor.viewport.width;
        const scaleY = guest.height / anchor.viewport.height;
        const x = guest.left - container.left + anchor.bounds.x * scaleX;
        const y = guest.top - container.top + anchor.bounds.y * scaleY;
        const right = x + anchor.bounds.width * scaleX;
        const lower = y + anchor.bounds.height * scaleY;
        left = clampX(x);
        if (lower + gap + height <= bottom) top = lower + gap;
        else if (y - gap - height >= padding) top = y - gap - height;
        else if (right + gap + width <= container.width - padding) { left = right + gap; top = clampY(y); }
        else if (x - gap - width >= padding) { left = x - gap - width; top = clampY(y); }
        else top = clampY(y > container.height / 2 ? y - gap - height : lower + gap);
      }
      const next = { left: Math.round(clampX(left)), top: Math.round(clampY(top)), maxHeight: Math.max(80, bottom - padding) };
      setStyle((current) => current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
    };
    const refresh = async () => {
      try {
        const current = await bridge?.getAnnotationAnchor(tabId, target.id);
        if (disposed) return;
        anchor = current ?? null;
        position();
      } catch {
        // Navigation may destroy the isolated world; the draft remains editable in the host.
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 100);
    };
    position();
    void refresh();
    const observer = new ResizeObserver(position);
    observer.observe(surface);
    observer.observe(popover);
    if (webviewRef.current instanceof Element) observer.observe(webviewRef.current);
    window.addEventListener('scroll', position, { capture: true, passive: true });
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('scroll', position, true);
    };
  }, [bridge, enabled, surfaceRef, tabId, target, webviewRef]);

  return { ref, style };
}
