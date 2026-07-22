import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorPoint, onClose, open, placement, triggerRef]);

  if (!open) return null;

  return createPortal(
    <div
      className="desktop-agent-floating-menu"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
