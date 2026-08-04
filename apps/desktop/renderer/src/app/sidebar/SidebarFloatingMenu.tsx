import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { focusMenuItem, menuFocusIntent } from '../../shared/lib/menuFocus.js';
import { pageScaleInverse, zoomedPortalPosition } from '../../shared/lib/zoomedPortalPosition.js';

const MENU_WIDTH = 138;

export function SidebarFloatingMenu({
  anchorPoint,
  children,
  open,
  placement = 'bottom-left',
  triggerRef,
  onClose,
}: {
  anchorPoint?: { x: number; y: number };
  children: ReactNode;
  open: boolean;
  placement?: 'bottom-left' | 'bottom-right';
  triggerRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect && !anchorPoint) return;

      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      setPosition(zoomedPortalPosition({
        anchorX: anchorPoint?.x ?? (placement === 'bottom-right' ? (rect?.left ?? 0) : (rect?.right ?? 0)),
        anchorY: anchorPoint?.y ?? (rect?.bottom ?? 0),
        horizontalAlign: !anchorPoint && placement === 'bottom-left' ? 'end' : 'start',
        menuHeight,
        menuWidth: MENU_WIDTH,
        offsetY: anchorPoint ? 0 : 6,
        scaleInverse: pageScaleInverse(),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }));
    };
    updatePosition();
    const focusFrame = window.requestAnimationFrame(() => focusMenuItem(menuRef.current, 'first'));

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorPoint, onClose, open, placement, triggerRef]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    const intent = menuFocusIntent(event.key);
    if (!intent) return;
    event.preventDefault();
    focusMenuItem(event.currentTarget, intent);
  };

  return createPortal(
    <div
      className="desktop-agent-floating-menu"
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
