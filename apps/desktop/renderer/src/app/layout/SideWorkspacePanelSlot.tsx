import type { ComponentProps, ReactNode } from 'react';
import { WorkspaceResizeHandle } from '../../features/workspace/WorkspaceResizeHandle.js';

/** The slot owns resizing so Feature renderers can replace its content without losing the handle. */
export function SideWorkspacePanelSlot({
  children,
  ...resizeHandleProps
}: ComponentProps<typeof WorkspaceResizeHandle> & { children: ReactNode }) {
  return (
    <div className="desktop-workspace-panel-slot">
      <WorkspaceResizeHandle {...resizeHandleProps} />
      {children}
    </div>
  );
}
