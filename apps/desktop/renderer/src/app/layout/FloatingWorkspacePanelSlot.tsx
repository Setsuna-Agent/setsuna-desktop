import type { ReactNode } from 'react';
import type { DesktopPanelSlot } from '../../features/workspace/model.js';

export function FloatingWorkspacePanelSlot({
  children,
  hidden = false,
  placement,
}: {
  children: ReactNode;
  hidden?: boolean;
  placement: DesktopPanelSlot;
}) {
  return (
    <div
      className={placement === 'side'
        ? 'desktop-workspace-panel-slot'
        : 'desktop-floating-workspace-panel-slot'}
      hidden={hidden}
    >
      {children}
    </div>
  );
}
