import { useRef, type RefObject } from 'react';
import { shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { RendererOwnedListSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { AppTooltip, Button } from '../../shared/ui/primitives.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { ScrollOverlay } from '../../shared/ui/ScrollOverlay.js';
import { PluginAppOrderProvider } from '../../kernel/declarative-plugin-ui/app-order/PluginAppOrderProvider.js';
import { CreatePluginAppEntry } from '../app-creation/CreatePluginAppEntry.js';
import { usePluginAppCreation, type CreatePluginAppChat } from '../app-creation/usePluginAppCreation.js';
import { NavigationVisibilityMenu } from '../sidebar/NavigationVisibilityMenu.js';
import { SidebarUserMenu } from '../sidebar/SidebarUserMenu.js';
import { useStoredSidebarIds } from '../sidebar/useStoredSidebarIds.js';
import type { MainView } from '../types.js';
import { AppNavigationIcon, type AppNavigationIconName } from './AppNavigationIcon.js';

export function AppNavigationRail({
  activeView,
  activeProjectId,
  activeThreadId,
  selectedPluginViewKey,
  runtimeActivityTriggerRef,
  themeToggleTriggerRef,
  onOpenChat,
  onOpenDesign,
  onOpenCapabilities,
  onOpenPullRequests,
  onOpenAutomation,
  onOpenPluginView,
  onRefreshPluginView,
  onViewPlugin,
  onCreateApp,
  onFocusComposer,
  onOpenRuntimeActivity,
  onOpenSettings,
}: {
  activeView: MainView;
  activeProjectId: string | null;
  activeThreadId?: string;
  selectedPluginViewKey: string | null;
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
  themeToggleTriggerRef: RefObject<HTMLButtonElement>;
  onOpenChat: () => void;
  onOpenDesign: () => void;
  onOpenCapabilities: () => void;
  onOpenPullRequests: () => void;
  onOpenAutomation: () => void;
  onOpenPluginView: (viewKey: string) => void;
  onRefreshPluginView: (viewKey: string) => void;
  onViewPlugin: (pluginId: string) => void;
  onCreateApp: CreatePluginAppChat;
  onFocusComposer: () => void;
  onOpenRuntimeActivity: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const creation = usePluginAppCreation(onCreateApp, onFocusComposer);
  const { ids: hiddenEntries, toggle: toggleHiddenEntry } = useStoredSidebarIds('setsuna-hidden-navigation-entries', 'sidebar.navigationSaveFailed');
  const optionalRoutes: Omit<NavigationButtonProps, 'active'>[] = [
    { icon: 'design', label: t('feature.design.workspace'), onClick: onOpenDesign },
    { icon: 'pull-requests', label: 'Pull Request', commandId: 'app.openPullRequests', onClick: onOpenPullRequests },
    { icon: 'automation', label: t('feature.automation.title'), commandId: 'app.openAutomation', onClick: onOpenAutomation },
    { icon: 'capabilities', label: t('sidebar.plugins'), commandId: 'app.openCapabilities', onClick: onOpenCapabilities },
  ];
  return (
    <div className="app-navigation">
      <div className="app-navigation__viewport" ref={scrollRef}>
        <nav className="app-navigation__routes">
          <NavigationButton icon="chat" label={t('sidebar.chats')} commandId="app.openChat" active={activeView === 'chat'} onClick={onOpenChat} />
          {optionalRoutes.map((route) => !hiddenEntries.has(route.icon) && (
            <NavigationButton key={route.icon} active={activeView === route.icon} {...route} />
          ))}
          <NavigationVisibilityMenu routes={optionalRoutes} hiddenEntries={hiddenEntries} onToggle={toggleHiddenEntry} />
          <div className="app-navigation__plugins" role="group" aria-label={t('sidebar.pluginFeatures')}>
            <PluginAppOrderProvider hiddenEntryIds={hiddenEntries}>
              <RendererOwnedListSlot
                slot={shellSidebarPluginEntrySlot}
                props={{
                  activeViewKey: activeView === 'plugin' ? selectedPluginViewKey : null,
                  hiddenEntryIds: hiddenEntries,
                  ...(activeProjectId ? { projectId: activeProjectId } : {}),
                  ...(activeThreadId ? { threadId: activeThreadId } : {}),
                  onOpen: onOpenPluginView,
                  onRefresh: onRefreshPluginView,
                  onViewPlugin,
                  onModifyApp: (app) => { void creation.modify(app); },
                }}
              />
            </PluginAppOrderProvider>
            <CreatePluginAppEntry creation={creation} />
          </div>
        </nav>
      </div>
      <ScrollOverlay scrollRef={scrollRef} />
      <SidebarUserMenu
        settingsActive={activeView === 'settings'}
        runtimeActivityTriggerRef={runtimeActivityTriggerRef}
        themeToggleTriggerRef={themeToggleTriggerRef}
        onOpenRuntimeActivity={onOpenRuntimeActivity}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}

type NavigationButtonProps = {
  active: boolean;
  icon: AppNavigationIconName;
  commandId?: KeyboardShortcutCommandId;
  label: string;
  onClick: () => void;
};

function NavigationButton({ active, icon, commandId, label, onClick }: NavigationButtonProps) {
  const button = (
    <Button
      variant="ghost"
      className={`app-navigation__button${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <AppNavigationIcon name={icon} active={active} />
    </Button>
  );
  return commandId
    ? <ShortcutTooltip commandId={commandId} label={label} placement="right">{button}</ShortcutTooltip>
    : <AppTooltip title={label} placement="right">{button}</AppTooltip>;
}
