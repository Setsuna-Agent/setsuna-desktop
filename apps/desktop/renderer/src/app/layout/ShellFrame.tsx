import { Minus, PanelLeft, Plus, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { usesCustomFrameLayout } from '../../shared/lib/desktopPlatform.js';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';

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

  return (
    <div ref={rootRef} className={rootClassName} style={style}>
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <TitlebarNavigation
            sidebarCollapsed={sidebarCollapsed}
            showSidebarToggle={showSidebarToggle}
            onNewChat={menuActions?.onNewChat}
            onToggleSidebar={sidebarToggleAction}
          />
          {customFrame ? <WindowTopbarMenu actions={topbarMenuActions} /> : null}
          {customFrame && status ? <div className="app-topbar__status">{status}</div> : null}
        </div>
        {customFrame ? <div className="app-topbar__drag" aria-hidden="true" /> : null}
        {!customFrame ? (
          <>
            <div className="app-topbar__right">
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
          <div className="app-workbench__main-title">{toolbarTitle ? <div className="chat-toolbar-title">{toolbarTitle}</div> : viewTabs}</div>
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
  onNewChat,
  sidebarCollapsed,
  showSidebarToggle,
  onToggleSidebar,
}: {
  onNewChat?: () => void;
  sidebarCollapsed: boolean;
  showSidebarToggle: boolean;
  onToggleSidebar?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="app-topbar__nav">
      {showSidebarToggle && onToggleSidebar ? (
        <IconButton
          label={sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
          className="app-shell-icon-control"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={16} />
        </IconButton>
      ) : null}
      {onNewChat ? (
        <IconButton label={t('app.newChat')} className="app-shell-icon-control app-topbar__new-chat" onClick={onNewChat}>
          <Plus size={15} />
        </IconButton>
      ) : null}
    </div>
  );
}

function WindowTopbarMenu({ actions }: { actions: WindowMenuActions }) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<WindowMenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menus = useMemo(() => windowMenuDefinitions(actions, t), [actions, t]);
  const windowMenuLabels: Array<{ key: WindowMenuKey; label: string }> = [
    { key: 'file', label: t('shell.menu.file') },
    { key: 'edit', label: t('shell.menu.edit') },
    { key: 'view', label: t('shell.menu.view') },
    { key: 'help', label: t('shell.menu.help') },
  ];

  useEffect(() => {
    if (!openMenu) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
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
            className={`app-topbar__menu-item ${openMenu === item.key ? 'is-open' : ''}`}
            type="button"
            onMouseDown={preventMouseFocus}
            onClick={() => setOpenMenu((current) => (current === item.key ? null : item.key))}
          >
            {item.label}
          </button>
          {openMenu === item.key ? (
            <span className="app-topbar__menu-popover" role="menu">
              {menus[item.key].map((menuItem) => (
                <button
                  disabled={menuItem.disabled}
                  key={menuItem.key}
                  role="menuitem"
                  type="button"
                  onMouseDown={preventMouseFocus}
                  onClick={() => {
                    if (menuItem.disabled) return;
                    setOpenMenu(null);
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

function preventMouseFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function windowMenuDefinitions(actions: WindowMenuActions, t: Translate): Record<WindowMenuKey, WindowMenuItem[]> {
  return {
    file: [
      menuItem('new-chat', t('app.newChat'), actions.onNewChat),
      menuItem('settings', t('shell.menu.settings'), actions.onOpenSettings),
    ],
    edit: [
      commandMenuItem('cut', t('shell.menu.cut')),
      commandMenuItem('copy', t('shell.menu.copy')),
      commandMenuItem('paste', t('shell.menu.paste')),
      commandMenuItem('select-all', t('shell.menu.selectAll'), 'selectAll'),
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

function commandMenuItem(key: string, label: string, command = key): WindowMenuItem {
  return menuItem(key, label, () => {
    document.execCommand(command);
  });
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
