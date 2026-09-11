import { Popover } from '@setsuna-desktop/renderer-ui';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export function SidebarHoverCard({ children, className, content, disabled }: {
  children: ReactElement;
  className: string;
  content: (dismiss: () => void) => ReactNode;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dismissed = useRef(false);
  const dismiss = () => {
    // A pending hover/focus delay must not reopen the card after navigation or an action.
    dismissed.current = true;
    setOpen(false);
  };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return (
    <Popover
      trigger="hover"
      placement="rightTop"
      mouseEnterDelay={0.35}
      mouseLeaveDelay={0.15}
      open={open && !disabled}
      onOpenChange={(next) => setOpen(next && !disabled && !dismissed.current)}
      onPointerEnter={() => { dismissed.current = false; }}
      onFocusCapture={() => { dismissed.current = false; }}
      onPointerDownCapture={dismiss}
      onClickCapture={dismiss}
      onContextMenuCapture={dismiss}
      onKeyDownCapture={dismiss}
      className={`desktop-agent-hover-card ${className}`}
      content={content(dismiss)}
    >
      {children}
    </Popover>
  );
}
