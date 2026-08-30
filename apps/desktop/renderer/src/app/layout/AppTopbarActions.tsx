import { CircleGauge } from 'lucide-react';
import { shellTopbarActionSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { RendererOwnedListSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { PanelPlacementIcon } from '../../features/workspace/PanelPlacementIcon.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import type { MainView } from '../types.js';

export function AppTopbarActions({
  activeView,
  bottomPanelVisible,
  bottomTerminalPanelActive,
  conversationOverviewAvailable,
  conversationOverviewVisible,
  sidePanelVisible,
  onToggleConversationOverview,
  onToggleSidePanel,
  onToggleBottomTerminal,
}: {
  activeView: MainView;
  bottomPanelVisible: boolean;
  bottomTerminalPanelActive: boolean;
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
      <RendererOwnedListSlot
        slot={shellTopbarActionSlot}
        props={{ activeRouteId: activeView, translate: t, ui: { IconButton } }}
      />
      {activeView === 'chat' && conversationOverviewAvailable ? (
        <ShortcutTooltip
          commandId="chat.toggleOverview"
          label={conversationOverviewVisible ? t('topbar.hideEnvironment') : t('topbar.showEnvironment')}
        >
          <IconButton
            label={conversationOverviewVisible ? t('topbar.hideEnvironment') : t('topbar.showEnvironment')}
            title=""
            aria-pressed={conversationOverviewVisible}
            className={`app-shell-icon-control ${conversationOverviewVisible ? 'is-active' : ''}`}
            onClick={onToggleConversationOverview}
          >
            <CircleGauge size={16} />
          </IconButton>
        </ShortcutTooltip>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <ShortcutTooltip
          commandId="layout.toggleTerminal"
          label={bottomTerminalPanelActive ? t('topbar.closeTerminal') : t('topbar.openBottomTerminal')}
        >
          <IconButton
            label={bottomTerminalPanelActive ? t('topbar.closeTerminal') : t('topbar.openBottomTerminal')}
            title=""
            aria-pressed={bottomTerminalPanelActive}
            className={`app-shell-icon-control ${bottomPanelVisible ? 'is-active' : ''}`}
            onClick={onToggleBottomTerminal}
          >
            <PanelPlacementIcon placement="bottom" size={16} />
          </IconButton>
        </ShortcutTooltip>
      ) : null}
      {activeView === 'chat' && !sidePanelVisible ? (
        <ShortcutTooltip commandId="layout.toggleWorkspace" label={t('topbar.openRightSidebar')}>
          <IconButton
            title=""
            label={t('topbar.openRightSidebar')}
            aria-pressed={false}
            className="app-shell-icon-control"
            onClick={onToggleSidePanel}
          >
            <PanelPlacementIcon placement="side" size={16} />
          </IconButton>
        </ShortcutTooltip>
      ) : null}
    </>
  );
}
