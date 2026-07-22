import { Bell, CircleGauge, PanelRight, Terminal } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
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
  const { t } = useI18n();

  return (
    <>
      {updater.ready ? (
        <IconButton
          label={updater.state?.manualInstall ? t('topbar.openInstaller') : t('topbar.restartUpdate')}
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
          label={conversationOverviewVisible ? t('topbar.hideEnvironment') : t('topbar.showEnvironment')}
          aria-pressed={conversationOverviewVisible}
          className={`app-shell-icon-control ${conversationOverviewVisible ? 'is-active' : ''}`}
          onClick={onToggleConversationOverview}
        >
          <CircleGauge size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton
          label={bottomTerminalPanelOpen ? t('topbar.closeTerminal') : t('topbar.openTerminal')}
          className={`app-shell-icon-control ${bottomTerminalPanelOpen ? 'is-active' : ''}`}
          onClick={onToggleBottomTerminal}
        >
          <Terminal size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton label={t('topbar.openRightSidebar')} className="app-shell-icon-control" onClick={onToggleSidePanel}>
          <PanelRight size={16} />
        </IconButton>
      ) : null}
    </>
  );
}
