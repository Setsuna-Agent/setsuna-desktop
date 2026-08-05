import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const appRouteTopbarSlotId = 'app-route-topbar-slot';

export function AppRouteTopbarPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(() => (
    typeof document === 'undefined' ? null : document.getElementById(appRouteTopbarSlotId)
  ));

  useEffect(() => {
    if (target?.isConnected) return;
    setTarget(document.getElementById(appRouteTopbarSlotId));
  }, [target]);

  return target ? createPortal(children, target) : null;
}
