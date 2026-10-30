import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Keep the menu beside its host card while retaining the real button as the focus/keyboard trigger. */
export function useTerminalActionMenuPosition(anchorRef: RefObject<HTMLElement> | undefined, open: boolean) {
  const triggerRef = useRef<HTMLElement>(null);
  const [align, setAlign] = useState<{ offset: number[] }>();

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const trigger = triggerRef.current;
    if (!open || !anchor || !trigger) return;
    const update = () => {
      const card = anchor.getBoundingClientRect();
      const button = trigger.getBoundingClientRect();
      // Dropdown offsets use viewport pixels, matching its zoom-neutral portal.
      setAlign({ offset: [card.top - button.top, button.left - card.left + 8] });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(trigger.parentElement ?? trigger);
    return () => observer.disconnect();
  }, [anchorRef, open]);

  return { triggerRef, align, placement: anchorRef ? 'leftTop' as const : 'bottomRight' as const };
}
