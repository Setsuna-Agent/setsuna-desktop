import { WorkspaceTopbar } from '../../features/workspace/WorkspaceTopbar.js';
import type { DesktopWorkspacePanelsState } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import { PanelPlacementIcon } from '../../features/workspace/PanelPlacementIcon.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';

export function AppWorkspaceToolbar({
  projectWorkspace,
  workspacePanels,
}: {
  projectWorkspace: ProjectWorkspaceState;
  workspacePanels: DesktopWorkspacePanelsState;
}) {
  if (!workspacePanels.sidePanelPresent) return null;

  const sidePanels = workspacePanels.sidePanelSlot.panels;
  const activePanel = sidePanels.find((panel) => panel.id === workspacePanels.sidePanelSlot.active) ?? null;
  if (activePanel?.type === 'overview') {
    return (
      <WorkspaceOverviewToolbar
        bottomPanelOpen={workspacePanels.bottomPanelVisible}
        bottomTerminalActive={workspacePanels.bottomTerminalPanelActive}
        onToggleTerminal={workspacePanels.toggleBottomTerminal}
        onToggleWorkspace={workspacePanels.toggleSidePanel}
      />
    );
  }

  return (
    <WorkspaceTopbar
      activePanelId={workspacePanels.sidePanelSlot.active}
      availablePanelTypes={workspacePanels.panelLauncherTypes}
      panels={workspacePanels.sidePanelSlot.panels}
      bottomPanelOpen={workspacePanels.bottomPanelVisible}
      bottomTerminalActive={workspacePanels.bottomTerminalPanelActive}
      onClosePanel={(panelId) => workspacePanels.closeDesktopPanelItem('side', panelId)}
      onOpenBrowser={() => {
        workspacePanels.openBrowserPanel();
      }}
      onOpenConversationDebug={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'conversation-debug');
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
      onMovePanel={(panelId, targetPlacement, targetPanelId, placement) => {
        workspacePanels.moveDesktopPanel('side', panelId, targetPlacement, targetPanelId, placement);
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
  bottomPanelOpen,
  bottomTerminalActive,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  bottomPanelOpen: boolean;
  bottomTerminalActive: boolean;
  onToggleTerminal: () => void;
  onToggleWorkspace: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="desktop-workspace-toolbar desktop-workspace-toolbar--overview"
      data-desktop-panel-placement="side"
    >
      <div className="chat-file-review-panel__header">
        <div className="chat-file-review-panel__heading">
          <span className="chat-file-review-panel__tabs" aria-hidden="true" />
          <span className="chat-file-review-panel__heading-actions">
            <ShortcutTooltip
              commandId="layout.toggleTerminal"
              label={bottomTerminalActive ? t('topbar.closeTerminal') : t('topbar.openBottomTerminal')}
            >
              <button
                className={[
                  'app-shell-icon-control',
                  'chat-file-review-panel__close',
                  'chat-file-review-panel__terminal-action',
                  bottomPanelOpen ? 'chat-file-review-panel__close--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-label={bottomTerminalActive ? t('topbar.closeTerminal') : t('topbar.openBottomTerminal')}
                aria-pressed={bottomTerminalActive}
                onClick={onToggleTerminal}
              >
                <PanelPlacementIcon placement="bottom" />
              </button>
            </ShortcutTooltip>
            <ShortcutTooltip commandId="layout.toggleWorkspace" label={t('topbar.collapseRightSidebar')}>
              <button
                className="app-shell-icon-control chat-file-review-panel__close chat-file-review-panel__panel-close chat-file-review-panel__close--active"
                type="button"
                aria-label={t('topbar.collapseRightSidebar')}
                aria-pressed={true}
                onClick={onToggleWorkspace}
              >
                <PanelPlacementIcon placement="side" />
              </button>
            </ShortcutTooltip>
          </span>
        </div>
      </div>
    </div>
  );
}
