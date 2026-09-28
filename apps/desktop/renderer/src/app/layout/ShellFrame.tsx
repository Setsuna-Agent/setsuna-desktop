import { Button } from '@setsuna-desktop/renderer-ui';
import { Minus, PanelLeft, Plus, X } from 'lucide-react';
import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { appRouteTopbarSlotId } from '../../shared/ui/AppRouteTopbarPortal.js';

export function ShellFrame({
  children,
  status,
  rootRef,
  style,
  sidebarCollapsed = false,
  onToggleSidebar,
  showSidebarToggle = true,
  navigationRail,
  navigationActions,
  toolbarTitle,
  viewTabs,
  workspaceToolbar,
  actions,
  onNewChat,
  className = '',
  inspectorOpen = true,
}: {
  children?: ReactNode;
  status?: ReactNode;
  rootRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  showSidebarToggle?: boolean;
  navigationRail?: ReactNode;
  navigationActions?: ReactNode;
  toolbarTitle?: ReactNode;
  viewTabs?: ReactNode;
  workspaceToolbar?: ReactNode;
  actions?: ReactNode;
  onNewChat?: () => void;
  className?: string;
  inspectorOpen?: boolean;
}) {
  const showWindowControls = getDesktopPlatform() === 'win32';
  const windowMaximized = useWindowMaximizedState();
  const sidebarToggleAction = showSidebarToggle ? onToggleSidebar : undefined;
  const rootClassName = [
    'app-shell',
    'desktop-agent-page',
    windowMaximized ? 'app-shell--window-maximized' : '',
    inspectorOpen ? 'app-shell--inspector-open' : '',
    navigationRail ? 'app-shell--with-navigation' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const routeTopbarSlot = <div className="app-topbar__route-slot" id={appRouteTopbarSlotId} />;

  return (
    <div ref={rootRef} className={rootClassName} style={style}>
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <TitlebarNavigation
            actions={navigationActions}
            sidebarCollapsed={sidebarCollapsed}
            showSidebarToggle={showSidebarToggle}
            onNewChat={sidebarCollapsed && showSidebarToggle ? onNewChat : undefined}
            onToggleSidebar={sidebarToggleAction}
          />
        </div>
        <div className="app-topbar__right">
          {routeTopbarSlot}
          {toolbarTitle ? <div className="chat-toolbar-title">{toolbarTitle}</div> : viewTabs}
          {status}
          {actions}
        </div>
        <div className="app-topbar__workspace">{workspaceToolbar}</div>
        {showWindowControls ? <WindowControls /> : null}
      </header>
      {navigationRail}
      <div className={`app-workbench ${inspectorOpen ? '' : 'app-workbench--inspector-closed'}`}>
        {children}
      </div>
    </div>
  );
}

function useWindowMaximizedState(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const controls = window.setsunaDesktop?.windowControls;
    if (!controls) return undefined;

    let active = true;
    let receivedChange = false;
    const unsubscribe = controls.onMaximizedChange((nextMaximized) => {
      receivedChange = true;
      setMaximized(nextMaximized);
    });
    void controls.isMaximized().then((initialMaximized) => {
      if (active && !receivedChange) setMaximized(initialMaximized);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return maximized;
}

function TitlebarNavigation({
  actions,
  onNewChat,
  sidebarCollapsed,
  showSidebarToggle,
  onToggleSidebar,
}: {
  actions?: ReactNode;
  onNewChat?: () => void;
  sidebarCollapsed: boolean;
  showSidebarToggle: boolean;
  onToggleSidebar?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="app-topbar__nav">
      {actions}
      {showSidebarToggle && onToggleSidebar ? (
        <ShortcutTooltip
          commandId="layout.toggleSidebar"
          label={sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
        >
          <IconButton
            label={sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
            title=""
            className="app-shell-icon-control"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} />
          </IconButton>
        </ShortcutTooltip>
      ) : null}
      {onNewChat ? (
        <ShortcutTooltip commandId="app.newChat" label={t('app.newChat')}>
          <IconButton title="" label={t('app.newChat')} className="app-shell-icon-control app-topbar__new-chat" onClick={onNewChat}>
            <Plus size={15} />
          </IconButton>
        </ShortcutTooltip>
      ) : null}
    </div>
  );
}

function WindowControls() {
  const controls = window.setsunaDesktop?.windowControls;
  const { t } = useI18n();

  return (
    <div className="app-window-controls" aria-label={t('shell.window.controls')}>
      <Button variant="ghost" type="button" aria-label={t('shell.window.minimize')} title={t('shell.window.minimize')} onClick={() => void controls?.minimize()}>
        <Minus size={14} />
      </Button>
      <Button variant="ghost" type="button" aria-label={t('shell.window.maximize')} title={t('shell.window.maximize')} onClick={() => void controls?.toggleMaximize()}>
        <WindowMaximizeIcon />
      </Button>
      <Button variant="ghost" className="app-window-controls__close" type="button" aria-label={t('shell.window.close')} title={t('shell.window.close')} onClick={() => void controls?.close()}>
        <X size={14} />
      </Button>
    </div>
  );
}

function WindowMaximizeIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.4" />
    </svg>
  );
}
