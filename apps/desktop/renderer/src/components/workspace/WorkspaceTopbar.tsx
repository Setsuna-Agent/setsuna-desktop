import { DesktopPanelHeader } from './DesktopPanelHeader.js';
import type { DesktopPanelTab, DesktopPanelType } from './model.js';

export function WorkspaceTopbar({
  activePanelId,
  availablePanelTypes,
  panels,
  terminalOpen,
  onClosePanel,
  onOpenFilesPanel,
  onOpenReviewPanel,
  onOpenTerminalPanel,
  onSelectPanel,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  activePanelId: string | null;
  availablePanelTypes: DesktopPanelType[];
  panels: DesktopPanelTab[];
  terminalOpen: boolean;
  onClosePanel: (panelId: string) => void;
  onOpenFilesPanel: () => void;
  onOpenReviewPanel: () => void;
  onOpenTerminalPanel: () => void;
  onSelectPanel: (panelId: string) => void;
  onToggleTerminal: () => void;
  onToggleWorkspace: () => void;
}) {
  const activePanel = panels.find((panel) => panel.id === activePanelId) ?? panels[0] ?? null;
  const handleOpenPanel = (panel: DesktopPanelType) => {
    if (panel === 'review') {
      onOpenReviewPanel();
      return;
    }
    if (panel === 'files') {
      onOpenFilesPanel();
      return;
    }
    if (panel === 'terminal') onOpenTerminalPanel();
  };

  if (!activePanel) return null;

  return (
    <div className="desktop-workspace-toolbar">
      <DesktopPanelHeader
        activePanel={activePanel.type}
        activePanelId={activePanel.id}
        availablePanelTypes={availablePanelTypes}
        bottomBarActive={terminalOpen}
        onClose={onToggleWorkspace}
        onClosePanel={onClosePanel}
        onOpenPanel={handleOpenPanel}
        onSelectPanel={onSelectPanel}
        onToggleBottomTerminal={onToggleTerminal}
        panels={panels}
        placement="side"
      />
    </div>
  );
}
