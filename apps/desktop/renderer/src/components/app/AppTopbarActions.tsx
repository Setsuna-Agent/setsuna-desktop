import { Bell, PanelRight, Terminal } from 'lucide-react';
import { IconButton } from '../primitives.js';
import type { DesktopUpdaterStateView } from '../../hooks/useDesktopUpdater.js';
import type { MainView } from '../../types/app.js';

export function AppTopbarActions({
  updater,
  hasProject,
  activeView,
  bottomTerminalPanelOpen,
  sidePanelVisible,
  onToggleSidePanel,
  onToggleBottomTerminal,
}: {
  updater: DesktopUpdaterStateView;
  hasProject: boolean;
  activeView: MainView;
  bottomTerminalPanelOpen: boolean;
  sidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  onToggleBottomTerminal: () => void;
}) {
  return (
    <>
      {updater.ready ? (
        <IconButton
          label={updater.state?.manualInstall ? '打开更新安装包' : '重启安装更新'}
          className="app-topbar-update-alert"
          disabled={updater.installing}
          onClick={() => void updater.promptReadyUpdate()}
        >
          <Bell size={15} />
          <span className="app-topbar-update-alert__badge" aria-hidden="true" />
        </IconButton>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton
          label={bottomTerminalPanelOpen ? '关闭终端' : '打开终端'}
          className={bottomTerminalPanelOpen ? 'is-active' : ''}
          onClick={onToggleBottomTerminal}
        >
          <Terminal size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && hasProject && !sidePanelVisible ? (
        <IconButton label="打开右侧栏" onClick={onToggleSidePanel}>
          <PanelRight size={16} />
        </IconButton>
      ) : null}
    </>
  );
}
