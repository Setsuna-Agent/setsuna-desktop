import type { ReactNode } from 'react';
import { DesktopPanelHeader, type DesktopPanelPlacement } from './DesktopPanelHeader.js';
import type { DesktopPanelDropPlacement, DesktopPanelTab } from './model.js';

export function WorkspaceTopbar({
  actions,
  activePanelId,
  panels,
  unsavedFilePath,
  isFileDirty,
  bottomPanelOpen,
  onClosePanel,
  onOpenOverview,
  onMovePanel,
  onSelectPanel,
  onReorderPanels,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  actions?: ReactNode;
  activePanelId: string | null;
  panels: DesktopPanelTab[];
  unsavedFilePath?: string | null;
  isFileDirty?: (path: string, rootId?: string) => boolean;
  bottomPanelOpen: boolean;
  onClosePanel: (panelId: string) => void;
  onOpenOverview: () => void;
  onMovePanel: (
    panelId: string,
    targetPlacement: DesktopPanelPlacement,
    targetPanelId: string | null,
    placement: DesktopPanelDropPlacement,
  ) => void;
  onSelectPanel: (panelId: string) => void;
  onReorderPanels: (panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement) => void;
  onToggleTerminal: () => void;
  onToggleWorkspace: () => void;
}) {
  const activePanel = panels.find((panel) => panel.id === activePanelId) ?? panels[0] ?? null;

  if (!activePanel) return null;

  return (
    <div className="desktop-workspace-toolbar">
      <DesktopPanelHeader
        actions={actions}
        activePanel={activePanel.type}
        activePanelId={activePanel.id}
        bottomBarActive={bottomPanelOpen}
        onClose={onToggleWorkspace}
        onClosePanel={onClosePanel}
        onMovePanel={onMovePanel}
        onAddPanel={onOpenOverview}
        onReorderPanels={onReorderPanels}
        onSelectPanel={onSelectPanel}
        onToggleBottomTerminal={onToggleTerminal}
        panels={panels}
        placement="side"
        unsavedFilePath={unsavedFilePath}
        isFileDirty={isFileDirty}
      />
    </div>
  );
}
