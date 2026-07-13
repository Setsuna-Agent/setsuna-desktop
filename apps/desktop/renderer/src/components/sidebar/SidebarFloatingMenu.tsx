import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

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
      const desiredLeft = anchorPoint?.x ?? (placement === 'bottom-right' ? (rect?.left ?? 0) : (rect?.right ?? 0) - MENU_WIDTH);
      const desiredTop = anchorPoint?.y ?? (rect?.bottom ?? 0) + 6;
      const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
      const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
      setPosition({
        left: Math.min(Math.max(8, desiredLeft), maxLeft),
        top: Math.min(Math.max(8, desiredTop), maxTop),
      });
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
