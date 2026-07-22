import { Bell, CircleGauge, PanelRight, Terminal } from 'lucide-react';
import { IconButton } from '../../shared/ui/primitives.js';
import type { DesktopUpdaterStateView } from '../controller/useDesktopUpdater.js';
import type { MainView } from '../types.js';

export function AppTopbarActions({
  updater,
  activeView,
  bottomTerminalPanelOpen,
  conversationOverviewAvailable,
  conversationOverviewVisible,
  sidePanelVisible,
  onToggleConversationOverview,
  onToggleSidePanel,
  onToggleBottomTerminal,
}: {
  updater: DesktopUpdaterStateView;
  activeView: MainView;
  bottomTerminalPanelOpen: boolean;
  conversationOverviewAvailable: boolean;
  conversationOverviewVisible: boolean;
  sidePanelVisible: boolean;
  onToggleConversationOverview: () => void;
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
      {activeView === 'chat' && conversationOverviewAvailable ? (
        <IconButton
          label={conversationOverviewVisible ? '隐藏环境信息' : '显示环境信息'}
          aria-pressed={conversationOverviewVisible}
          className={`app-shell-icon-control ${conversationOverviewVisible ? 'is-active' : ''}`}
          onClick={onToggleConversationOverview}
        >
          <CircleGauge size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton
          label={bottomTerminalPanelOpen ? '关闭终端' : '打开终端'}
          className={`app-shell-icon-control ${bottomTerminalPanelOpen ? 'is-active' : ''}`}
          onClick={onToggleBottomTerminal}
        >
          <Terminal size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton label="打开右侧栏" className="app-shell-icon-control" onClick={onToggleSidePanel}>
          <PanelRight size={16} />
        </IconButton>
      ) : null}
    </>
  );
}
