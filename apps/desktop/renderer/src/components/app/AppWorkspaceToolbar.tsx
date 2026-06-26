import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { WorkspaceTopbar } from '../workspace/WorkspaceTopbar.js';
import type { DesktopWorkspacePanelsState } from '../../hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../hooks/useProjectWorkspace.js';
import type { DesktopPanelType } from '../workspace/model.js';

export function AppWorkspaceToolbar({
  activeProject,
  projectWorkspace,
  workspacePanels,
}: {
  activeProject?: WorkspaceProject;
  projectWorkspace: ProjectWorkspaceState;
  workspacePanels: DesktopWorkspacePanelsState;
}) {
  if (!workspacePanels.sidePanelVisible) return null;

  const sidePanels = workspacePanels.sidePanelSlot.panels;
  const sideAvailablePanelTypes = [
    activeProject && !sidePanels.some((panel) => panel.type === 'review') ? 'review' : null,
    activeProject?.path && !sidePanels.some((panel) => panel.type === 'files') ? 'files' : null,
    'terminal',
  ].filter(Boolean) as DesktopPanelType[];

  return (
    <WorkspaceTopbar
      activePanelId={workspacePanels.sidePanelSlot.active}
      availablePanelTypes={sideAvailablePanelTypes}
      panels={workspacePanels.sidePanelSlot.panels}
      terminalOpen={workspacePanels.bottomTerminalPanelOpen}
      onClosePanel={(panelId) => workspacePanels.closeDesktopPanelItem('side', panelId)}
      onOpenFilesPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenReviewPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'review');
        void workspacePanels.loadReviewState();
      }}
      onOpenTerminalPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'terminal');
      }}
      onSelectPanel={(panelId) => {
        const panel = workspacePanels.sidePanelSlot.panels.find((item) => item.id === panelId);
        if (panel?.type === 'file' && panel.filePath) {
          void projectWorkspace.openProjectFile(panel.filePath);
          return;
        }
        workspacePanels.activateDesktopPanel('side', panelId);
      }}
      onToggleTerminal={workspacePanels.toggleBottomTerminal}
      onToggleWorkspace={workspacePanels.toggleSidePanel}
    />
  );
}
