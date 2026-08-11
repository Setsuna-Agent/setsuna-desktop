import { DesktopPanelHeader, type DesktopPanelPlacement } from './DesktopPanelHeader.js';
import type { DesktopPanelDropPlacement, DesktopPanelTab, DesktopPanelType } from './model.js';

export function WorkspaceTopbar({
  activePanelId,
  availablePanelTypes,
  panels,
  bottomPanelOpen,
  onClosePanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenFilesPanel,
  onOpenReviewPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
  onMovePanel,
  onSelectPanel,
  onReorderPanels,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  activePanelId: string | null;
  availablePanelTypes: DesktopPanelType[];
  panels: DesktopPanelTab[];
  bottomPanelOpen: boolean;
  onClosePanel: (panelId: string) => void;
  onOpenBrowser: () => void;
  onOpenConversationDebug: () => void;
  onOpenFilesPanel: () => void;
  onOpenReviewPanel: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
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
  const handleOpenPanel = (panel: DesktopPanelType) => {
    if (panel === 'browser') {
      onOpenBrowser();
      return;
    }
    if (panel === 'chat') {
      onOpenSideChat();
      return;
    }
    if (panel === 'conversation-debug') {
      onOpenConversationDebug();
      return;
    }
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
        bottomBarActive={bottomPanelOpen}
        onClose={onToggleWorkspace}
        onClosePanel={onClosePanel}
        onMovePanel={onMovePanel}
        onOpenPanel={handleOpenPanel}
        onReorderPanels={onReorderPanels}
        onSelectPanel={onSelectPanel}
        onToggleBottomTerminal={onToggleTerminal}
        panels={panels}
        placement="side"
      />
    </div>
  );
}
