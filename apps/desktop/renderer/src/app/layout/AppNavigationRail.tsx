import { Blocks, Clock3, GitPullRequest, Home } from 'lucide-react';
import { useRef, type ReactNode, type RefObject } from 'react';
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
import { SidebarUserMenu } from '../sidebar/SidebarUserMenu.js';
import type { MainView } from '../types.js';

export function AppNavigationRail({
  activeView,
  activeProjectId,
  activeThreadId,
  selectedPluginViewKey,
  runtimeActivityTriggerRef,
  themeToggleTriggerRef,
  onOpenChat,
  onOpenCapabilities,
  onOpenPullRequests,
  onOpenAutomation,
  onOpenPluginView,
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
  onOpenCapabilities: () => void;
  onOpenPullRequests: () => void;
  onOpenAutomation: () => void;
  onOpenPluginView: (viewKey: string) => void;
  onViewPlugin: (pluginId: string) => void;
  onCreateApp: CreatePluginAppChat;
  onFocusComposer: () => void;
  onOpenRuntimeActivity: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const creation = usePluginAppCreation(onCreateApp, onFocusComposer);
  return (
    <div className="app-navigation">
      <div className="app-navigation__viewport" ref={scrollRef}>
        <nav className="app-navigation__routes">
          <NavigationButton label={t('sidebar.chats')} commandId="app.openChat" active={activeView === 'chat'} onClick={onOpenChat}>
            <Home size={18} />
          </NavigationButton>
          <NavigationButton label="Pull Request" commandId="app.openPullRequests" active={activeView === 'pull-requests'} onClick={onOpenPullRequests}>
            <GitPullRequest size={18} />
          </NavigationButton>
          <NavigationButton label={t('feature.automation.title')} active={activeView === 'automation'} onClick={onOpenAutomation}>
            <Clock3 size={18} />
          </NavigationButton>
          <NavigationButton label={t('sidebar.plugins')} commandId="app.openCapabilities" active={activeView === 'capabilities'} onClick={onOpenCapabilities}>
            <Blocks size={18} />
          </NavigationButton>
          <div className="app-navigation__plugins" role="group" aria-label={t('sidebar.pluginFeatures')}>
            <PluginAppOrderProvider>
              <RendererOwnedListSlot
                slot={shellSidebarPluginEntrySlot}
                props={{
                  activeViewKey: activeView === 'plugin' ? selectedPluginViewKey : null,
                  ...(activeProjectId ? { projectId: activeProjectId } : {}),
                  ...(activeThreadId ? { threadId: activeThreadId } : {}),
                  onOpen: onOpenPluginView,
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

function NavigationButton({
  active,
  children,
  commandId,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  commandId?: KeyboardShortcutCommandId;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      className={`app-navigation__button${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
  return commandId
    ? <ShortcutTooltip commandId={commandId} label={label} placement="right">{button}</ShortcutTooltip>
    : <AppTooltip title={label} placement="right">{button}</AppTooltip>;
}
