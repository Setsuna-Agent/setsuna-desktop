import { Minus, PanelLeft, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { usesCustomFrameLayout } from '../../shared/lib/desktopPlatform.js';
import {
  captureDocumentEditTarget,
  executeDocumentEditCommand,
  type DocumentEditTarget,
} from '../../shared/lib/documentEditCommand.js';
import { focusMenuItem, menuFocusIntent } from '../../shared/lib/menuFocus.js';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { appRouteTopbarSlotId } from '../../shared/ui/AppRouteTopbarPortal.js';

type WindowMenuKey = 'file' | 'edit' | 'view' | 'help';

type WindowMenuActions = {
  onNewChat?: () => void;
  onOpenCapabilities?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
};

type WindowMenuItem = {
  key: string;
  label: string;
  disabled?: boolean;
  action: () => void;
};

export function ShellFrame({
  children,
  status,
  rootRef,
  style,
  sidebarCollapsed = false,
  onToggleSidebar,
  showSidebarToggle = true,
  navigationActions,
  toolbarTitle,
  viewTabs,
  workspaceToolbar,
  actions,
  menuActions,
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
  navigationActions?: ReactNode;
  toolbarTitle?: ReactNode;
  viewTabs?: ReactNode;
  workspaceToolbar?: ReactNode;
  actions?: ReactNode;
  menuActions?: WindowMenuActions;
  className?: string;
  inspectorOpen?: boolean;
}) {
  const customFrame = usesCustomFrameLayout();
  const windowMaximized = useWindowMaximizedState();
  const sidebarToggleAction = showSidebarToggle ? onToggleSidebar : undefined;
  const titlebarNewChatAction = !customFrame || (sidebarCollapsed && showSidebarToggle)
    ? menuActions?.onNewChat
    : undefined;
  const showTitlebarNavigation = !customFrame
    || Boolean(sidebarToggleAction || navigationActions || titlebarNewChatAction);
  const topbarMenuActions = useMemo(
    () => ({ ...menuActions, onToggleSidebar: sidebarToggleAction }),
    [menuActions, sidebarToggleAction],
  );
  const rootClassName = [
    'app-shell',
    'desktop-agent-page',
    windowMaximized ? 'app-shell--window-maximized' : '',
    inspectorOpen ? 'app-shell--inspector-open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const routeTopbarSlot = <div className="app-topbar__route-slot" id={appRouteTopbarSlotId} />;

  return (
    <div ref={rootRef} className={rootClassName} style={style}>
      <header className="app-topbar">
        <div className="app-topbar__brand">
          {showTitlebarNavigation ? (
            <TitlebarNavigation
              actions={navigationActions}
              sidebarCollapsed={sidebarCollapsed}
              showSidebarToggle={showSidebarToggle}
              onNewChat={titlebarNewChatAction}
              onToggleSidebar={sidebarToggleAction}
            />
          ) : null}
          {customFrame ? <WindowTopbarMenu actions={topbarMenuActions} /> : null}
          {customFrame && status ? <div className="app-topbar__status">{status}</div> : null}
        </div>
        {customFrame ? <div className="app-topbar__drag">{routeTopbarSlot}</div> : null}
        {!customFrame ? (
          <>
            <div className="app-topbar__right">
              {routeTopbarSlot}
              {toolbarTitle ? <div className="chat-toolbar-title">{toolbarTitle}</div> : viewTabs}
              {status}
              {actions}
            </div>
            <div className="app-topbar__workspace">{workspaceToolbar}</div>
          </>
        ) : null}
        {customFrame ? <WindowControls /> : null}
      </header>
      <div className={`app-workbench ${inspectorOpen ? '' : 'app-workbench--inspector-closed'}`}>
        {customFrame && (toolbarTitle || viewTabs) ? (
          <div className="app-workbench__main-title">
            {toolbarTitle ? <div className="chat-toolbar-title">{toolbarTitle}</div> : viewTabs}
          </div>
        ) : null}
        {customFrame && workspaceToolbar ? <div className="app-workbench__workspace-toolbar">{workspaceToolbar}</div> : null}
        {customFrame && actions ? <div className="app-workbench__main-actions">{actions}</div> : null}
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
      {actions}
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

function WindowTopbarMenu({ actions }: { actions: WindowMenuActions }) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<WindowMenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editTargetRef = useRef<DocumentEditTarget | null>(null);
  const rememberEditTarget = useCallback((element: Element | null) => {
    // Switching between topbar menus must not replace the original editor with a menu button.
    if (element && rootRef.current?.contains(element)) return;
    editTargetRef.current = captureDocumentEditTarget(element);
  }, []);
  const executeEditCommand = useCallback((command: string) => {
    const target = editTargetRef.current;
    editTargetRef.current = null;
    executeDocumentEditCommand(document, target, command);
  }, []);
  const menus = useMemo(
    () => windowMenuDefinitions(actions, t, executeEditCommand),
    [actions, executeEditCommand, t],
  );
  const windowMenuLabels: Array<{ key: WindowMenuKey; label: string }> = [
    { key: 'file', label: t('shell.menu.file') },
    { key: 'edit', label: t('shell.menu.edit') },
    { key: 'view', label: t('shell.menu.view') },
    { key: 'help', label: t('shell.menu.help') },
  ];

  useEffect(() => {
    if (!openMenu) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      const menu = rootRef.current?.querySelector<HTMLElement>(`[data-window-menu="${openMenu}"]`) ?? null;
      focusMenuItem(menu, 'first');
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      editTargetRef.current = null;
      setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  return (
    <nav className="app-topbar__menu" aria-label={t('shell.window.menu')} ref={rootRef}>
      {windowMenuLabels.map((item) => (
        <span className="app-topbar__menu-group" key={item.key}>
          <button
            aria-expanded={openMenu === item.key}
            aria-haspopup="menu"
            data-window-menu-trigger={item.key}
            className={`app-topbar__menu-item ${openMenu === item.key ? 'is-open' : ''}`}
            type="button"
            onFocus={(event) => {
              rememberEditTarget(event.relatedTarget instanceof Element ? event.relatedTarget : null);
            }}
            onPointerDown={() => rememberEditTarget(document.activeElement)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              setOpenMenu(item.key);
            }}
            onClick={() => setOpenMenu((current) => (current === item.key ? null : item.key))}
          >
            {item.label}
          </button>
          {openMenu === item.key ? (
            <span
              className="app-topbar__menu-popover"
              data-window-menu={item.key}
              role="menu"
              aria-orientation="vertical"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpenMenu(null);
                  rootRef.current
                    ?.querySelector<HTMLButtonElement>(`[data-window-menu-trigger="${item.key}"]`)
                    ?.focus();
                  return;
                }
                const intent = menuFocusIntent(event.key);
                if (!intent) return;
                event.preventDefault();
                focusMenuItem(event.currentTarget, intent);
              }}
            >
              {menus[item.key].map((menuItem) => (
                <button
                  disabled={menuItem.disabled}
                  key={menuItem.key}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    if (menuItem.disabled) return;
                    setOpenMenu(null);
                    if (item.key !== 'edit') editTargetRef.current = null;
                    menuItem.action();
                  }}
                >
                  {menuItem.label}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}

function windowMenuDefinitions(
  actions: WindowMenuActions,
  t: Translate,
  executeEditCommand: (command: string) => void,
): Record<WindowMenuKey, WindowMenuItem[]> {
  return {
    file: [
      menuItem('new-chat', t('app.newChat'), actions.onNewChat),
      menuItem('settings', t('shell.menu.settings'), actions.onOpenSettings),
    ],
    edit: [
      commandMenuItem('cut', t('shell.menu.cut'), executeEditCommand),
      commandMenuItem('copy', t('shell.menu.copy'), executeEditCommand),
      commandMenuItem('paste', t('shell.menu.paste'), executeEditCommand),
      commandMenuItem('select-all', t('shell.menu.selectAll'), executeEditCommand, 'selectAll'),
    ],
    view: [
      menuItem('toggle-sidebar', t('shell.menu.toggleSidebar'), actions.onToggleSidebar),
      menuItem('capabilities', t('shell.menu.capabilities'), actions.onOpenCapabilities),
    ],
    help: [
      menuItem('about', t('shell.menu.about'), () => {
        window.alert('Setsuna Desktop');
      }),
    ],
  };
}

function menuItem(key: string, label: string, action?: () => void): WindowMenuItem {
  return {
    key,
    label,
    disabled: !action,
    action: action ?? (() => undefined),
  };
}

function commandMenuItem(
  key: string,
  label: string,
  execute: (command: string) => void,
  command = key,
): WindowMenuItem {
  return menuItem(key, label, () => execute(command));
}

function WindowControls() {
  const controls = window.setsunaDesktop?.windowControls;
  const { t } = useI18n();

  return (
    <div className="app-window-controls" aria-label={t('shell.window.controls')}>
      <button type="button" aria-label={t('shell.window.minimize')} title={t('shell.window.minimize')} onClick={() => void controls?.minimize()}>
        <Minus size={14} />
      </button>
      <button type="button" aria-label={t('shell.window.maximize')} title={t('shell.window.maximize')} onClick={() => void controls?.toggleMaximize()}>
        <WindowMaximizeIcon />
      </button>
      <button className="app-window-controls__close" type="button" aria-label={t('shell.window.close')} title={t('shell.window.close')} onClick={() => void controls?.close()}>
        <X size={14} />
      </button>
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
