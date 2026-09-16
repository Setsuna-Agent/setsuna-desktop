import type { ReactNode } from 'react';
import type { DesktopPanelSlot } from '../../features/workspace/model.js';

export function FloatingWorkspacePanelSlot({
  children,
  hidden = false,
  keepRenderingWhenHidden = false,
  placement,
}: {
  children: ReactNode;
  hidden?: boolean;
  keepRenderingWhenHidden?: boolean;
  placement: DesktopPanelSlot;
}) {
  return (
    <div
      className={placement === 'side'
        ? 'desktop-workspace-panel-slot'
        : 'desktop-floating-workspace-panel-slot'}
      hidden={hidden}
      data-keep-rendering={hidden && keepRenderingWhenHidden ? true : undefined}
    >
      {children}
    </div>
  );
}
