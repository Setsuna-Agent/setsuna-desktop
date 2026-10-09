import { Button } from '@setsuna-desktop/renderer-ui';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { WorkspaceTopbar } from '../../features/workspace/WorkspaceTopbar.js';
import type { DesktopWorkspacePanelsState } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import { PanelPlacementIcon } from '../../features/workspace/PanelPlacementIcon.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { AppTooltip } from '../../shared/ui/primitives.js';

export function AppWorkspaceToolbar({
  projectWorkspace,
  workspacePanels,
  workspaceMaximized,
  onToggleMaximized,
}: {
  projectWorkspace: ProjectWorkspaceState;
  workspacePanels: DesktopWorkspacePanelsState;
  workspaceMaximized: boolean;
  onToggleMaximized: () => void;
}) {
  const { t } = useI18n();
  if (!workspacePanels.sidePanelPresent) return null;

  const maximizeLabel = t(workspaceMaximized ? 'workspace.panel.restoreWidth' : 'workspace.panel.maximize');
  const actions = (
    <AppTooltip title={maximizeLabel} placement="bottom">
      <Button variant="ghost"
        className={'app-shell-icon-control chat-file-review-panel__close' + (workspaceMaximized ? ' is-active' : '')}
        type="button"
        aria-label={maximizeLabel}
        aria-pressed={workspaceMaximized}
        onClick={onToggleMaximized}
      >
        {workspaceMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </Button>
    </AppTooltip>
  );
  const sidePanels = workspacePanels.sidePanelSlot.panels;
  const activePanel = sidePanels.find((panel) => panel.id === workspacePanels.sidePanelSlot.active) ?? null;
  if (activePanel?.type === 'overview') {
    return (
      <WorkspaceOverviewToolbar
        actions={actions}
        bottomPanelOpen={workspacePanels.bottomPanelVisible}
        onToggleTerminal={workspacePanels.toggleBottomPanel}
        onToggleWorkspace={workspacePanels.toggleSidePanel}
      />
    );
  }

  return (
    <WorkspaceTopbar
      actions={actions}
      activePanelId={workspacePanels.sidePanelSlot.active}
      availablePanelTypes={workspacePanels.panelLauncherTypes}
      panels={workspacePanels.sidePanelSlot.panels}
      isFileDirty={projectWorkspace.isFileDirty}
      bottomPanelOpen={workspacePanels.bottomPanelVisible}
      onClosePanel={(panelId) => workspacePanels.closeDesktopPanelItem('side', panelId)}
      onOpenBrowser={() => {
        workspacePanels.openBrowserPanel();
      }}
      onOpenConversationDebug={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'conversation-debug');
      }}
      onOpenFilesPanel={async () => {
        workspacePanels.closeWorkspaceMenus();
        if (!await projectWorkspace.setFilePreview(null)) return;
        workspacePanels.openDesktopPanel('side', 'files');
      }}
      onOpenReviewPanel={() => {
        workspacePanels.closeWorkspaceMenus();
        workspacePanels.openDesktopPanel('side', 'review');
        void workspacePanels.loadReviewState();
      }}
      onOpenChangesPanel={() => workspacePanels.openDesktopPanel('side', 'changes')}
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
      onSelectPanel={async (panelId) => {
        const panel = workspacePanels.sidePanelSlot.panels.find((item) => item.id === panelId);
        if (panel?.type === 'file' && panel.filePath) {
          void projectWorkspace.openProjectFile(panel.filePath, undefined, panel.rootId);
          return;
        }
        if (panel?.type === 'files' && !await projectWorkspace.setFilePreview(null)) return;
        workspacePanels.activateDesktopPanel('side', panelId);
      }}
      onToggleTerminal={workspacePanels.toggleBottomPanel}
      onToggleWorkspace={workspacePanels.toggleSidePanel}
    />
  );
}

function WorkspaceOverviewToolbar({
  actions,
  bottomPanelOpen,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  actions: ReactNode;
  bottomPanelOpen: boolean;
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
            {actions}
            <ShortcutTooltip
              commandId="layout.toggleTerminal"
              label={t(bottomPanelOpen ? 'workspace.panel.hideBottom' : 'workspace.panel.showBottom')}
            >
              <Button variant="ghost"
                className={[
                  'app-shell-icon-control',
                  'chat-file-review-panel__close',
                  'chat-file-review-panel__terminal-action',
                  bottomPanelOpen ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-label={t(bottomPanelOpen ? 'workspace.panel.hideBottom' : 'workspace.panel.showBottom')}
                aria-pressed={bottomPanelOpen}
                onClick={onToggleTerminal}
              >
                <PanelPlacementIcon placement="bottom" />
              </Button>
            </ShortcutTooltip>
            <ShortcutTooltip commandId="layout.toggleWorkspace" label={t('topbar.collapseRightSidebar')}>
              <Button variant="ghost"
                className="app-shell-icon-control chat-file-review-panel__close chat-file-review-panel__panel-close is-active"
                type="button"
                aria-label={t('topbar.collapseRightSidebar')}
                aria-pressed={true}
                onClick={onToggleWorkspace}
              >
                <PanelPlacementIcon placement="side" />
              </Button>
            </ShortcutTooltip>
          </span>
        </div>
      </div>
    </div>
  );
}
