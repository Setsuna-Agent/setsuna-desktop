import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { PanelRight, Terminal } from 'lucide-react';
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
  const activePanel = sidePanels.find((panel) => panel.id === workspacePanels.sidePanelSlot.active) ?? null;
  if (activePanel?.type === 'overview') {
    return (
      <WorkspaceOverviewToolbar
        terminalOpen={workspacePanels.bottomTerminalPanelOpen}
        onToggleTerminal={workspacePanels.toggleBottomTerminal}
        onToggleWorkspace={workspacePanels.toggleSidePanel}
      />
    );
  }

  const sideAvailablePanelTypes = [
    'chat',
    !sidePanels.some((panel) => panel.type === 'browser') ? 'browser' : null,
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
      onOpenBrowser={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'browser');
      }}
      onOpenFilesPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        projectWorkspace.setFilePreview(null);
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenReviewPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'review');
        void workspacePanels.loadReviewState();
      }}
      onOpenSideChat={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'chat');
      }}
      onOpenTerminalPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'terminal');
      }}
      onReorderPanels={(panelId, targetPanelId, placement) => {
        workspacePanels.reorderDesktopPanel('side', panelId, targetPanelId, placement);
      }}
      onSelectPanel={(panelId) => {
        const panel = workspacePanels.sidePanelSlot.panels.find((item) => item.id === panelId);
        if (panel?.type === 'file' && panel.filePath) {
          void projectWorkspace.openProjectFile(panel.filePath);
          return;
        }
        if (panel?.type === 'files') projectWorkspace.setFilePreview(null);
        workspacePanels.activateDesktopPanel('side', panelId);
      }}
      onToggleTerminal={workspacePanels.toggleBottomTerminal}
      onToggleWorkspace={workspacePanels.toggleSidePanel}
    />
  );
}

function WorkspaceOverviewToolbar({
  terminalOpen,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onToggleWorkspace: () => void;
}) {
  return (
    <div className="desktop-workspace-toolbar desktop-workspace-toolbar--overview">
      <div className="chat-file-review-panel__header">
        <div className="chat-file-review-panel__heading">
          <span className="chat-file-review-panel__tabs" aria-hidden="true" />
          <span className="chat-file-review-panel__heading-actions">
            <button
              className={[
                'chat-file-review-panel__close',
                'chat-file-review-panel__terminal-action',
                terminalOpen ? 'chat-file-review-panel__close--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              aria-label={terminalOpen ? '关闭底栏' : '打开底栏终端'}
              title={terminalOpen ? '关闭底栏' : '打开底栏终端'}
              onClick={onToggleTerminal}
            >
              <Terminal size={14} />
            </button>
            <button
              className="chat-file-review-panel__close chat-file-review-panel__panel-close chat-file-review-panel__close--active"
              type="button"
              aria-label="收起右侧栏"
              title="收起右侧栏"
              onClick={onToggleWorkspace}
            >
              <PanelRight size={14} />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
