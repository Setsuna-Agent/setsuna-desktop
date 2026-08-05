import type { WorkspaceCodeViewSurface } from './useWorkspaceCodeViewSurface.js';

export function WorkspaceCodeViewScrollbar({
  surface,
}: {
  surface: WorkspaceCodeViewSurface;
}) {
  return (
    <div
      aria-hidden="true"
      className="desktop-code-editor__horizontal-scrollbar"
      ref={surface.horizontalScrollbarRef}
    >
      <div
        className="desktop-code-editor__horizontal-scrollbar-track"
        ref={surface.horizontalScrollbarTrackRef}
      />
    </div>
  );
}
