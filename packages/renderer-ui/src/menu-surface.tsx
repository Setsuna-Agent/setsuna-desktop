import { motion, useReducedMotion } from 'motion/react';
import { forwardRef, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from './utils.js';

type MenuOrigin = { x: number; y: number };
type Highlight = { x: number; y: number; width: number; height: number };

/** beUI's pointer-origin reveal and gliding row, shared by Radix and host menus. */
export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { origin?: MenuOrigin }>(function MenuSurface({
  children, className, origin, style, onFocusCapture, onPointerMoveCapture, onBlurCapture, ...props
}, forwardedRef) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    setReady(false);
    // Radix positions its portal first; measure in local CSS pixels, including app zoom.
    const frame = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const [anchorX, anchorY] = getComputedStyle(node).transformOrigin.split(' ').map(Number.parseFloat);
      const scale = node.offsetWidth > 0 ? rect.width / node.offsetWidth : 1;
      const x = Math.max(0, Math.min(node.offsetWidth, origin ? (origin.x - rect.left) / (scale || 1) : anchorX || 0));
      const y = Math.max(0, Math.min(node.offsetHeight, origin ? (origin.y - rect.top) / (scale || 1) : anchorY || 0));
      node.style.setProperty('--sd-menu-clip-start', `inset(${Math.max(0, y - 8)}px ${Math.max(0, node.offsetWidth - x - 8)}px ${Math.max(0, node.offsetHeight - y - 8)}px ${Math.max(0, x - 8)}px round 8px)`);
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [origin?.x, origin?.y, style?.left, style?.top]);

  const updateHighlight = (target: EventTarget) => {
    const node = ref.current;
    const item = target instanceof Element ? target.closest<HTMLElement>('[role="menuitem"]') : null;
    // Portal events bubble through React; a submenu must not move its parent's highlight.
    if (!node || item?.closest('[role="menu"]') !== node || item.hasAttribute('data-disabled') || item.matches(':disabled')) return;
    // Custom menus can nest rows inside positioned search or zoom-control wrappers.
    const bounds = node.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    const scale = (node.offsetWidth > 0 ? bounds.width / node.offsetWidth : 1) || 1;
    const next = {
      x: (itemBounds.left - bounds.left) / scale + node.scrollLeft - node.clientLeft,
      y: (itemBounds.top - bounds.top) / scale + node.scrollTop - node.clientTop,
      width: itemBounds.width / scale,
      height: itemBounds.height / scale,
    };
    setHighlight((current) => current?.x === next.x && current.y === next.y
      && current.width === next.width && current.height === next.height ? current : next);
  };

  return <div {...props} style={style} className={cn('sd-menu-motion', className)} data-motion-ready={ready || reduce ? '' : undefined}
    ref={(node) => {
      ref.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    onFocusCapture={(event) => { onFocusCapture?.(event); updateHighlight(event.target); }}
    onPointerMoveCapture={(event) => { onPointerMoveCapture?.(event); if (event.pointerType !== 'touch') updateHighlight(event.target); }}
    onBlurCapture={(event) => {
      onBlurCapture?.(event);
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHighlight(null);
    }}>
    {highlight ? <motion.div aria-hidden="true" className="sd-menu-motion__highlight"
      initial={false} animate={{ x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }} /> : null}
    {children}
  </div>;
});
