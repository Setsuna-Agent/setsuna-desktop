import { Popover } from '@setsuna-desktop/renderer-ui';
import { useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { SidebarMenuOpenContext } from './SidebarMenuContext.js';

export function SidebarHoverCard({ children, className, content, disabled }: {
  children: ReactElement;
  className: string;
  content: (dismiss: () => void) => ReactNode;
  disabled: boolean;
}) {
  const menuOpen = useContext(SidebarMenuOpenContext);
  const suppressed = disabled || menuOpen;
  const [open, setOpen] = useState(false);
  const dismissed = useRef(false);
  const dismiss = () => {
    // A pending hover/focus delay must not reopen the card after navigation or an action.
    dismissed.current = true;
    setOpen(false);
  };
  useEffect(() => { if (suppressed) setOpen(false); }, [suppressed]);

  return (
    <Popover
      trigger="hover"
      placement="rightTop"
      mouseEnterDelay={0.35}
      mouseLeaveDelay={0.15}
      open={open && !suppressed}
      onOpenChange={(next) => setOpen(next && !suppressed && !dismissed.current)}
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
