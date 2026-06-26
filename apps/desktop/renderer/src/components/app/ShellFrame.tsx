import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { IconButton } from '../primitives.js';

export function ShellFrame({
  children,
  status,
  rootRef,
  style,
  sidebarCollapsed = false,
  onToggleSidebar,
  toolbarTitle,
  viewTabs,
  workspaceToolbar,
  actions,
  className = '',
  inspectorOpen = true,
}: {
  children?: ReactNode;
  status?: ReactNode;
  rootRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  toolbarTitle?: ReactNode;
  viewTabs?: ReactNode;
  workspaceToolbar?: ReactNode;
  actions?: ReactNode;
  className?: string;
  inspectorOpen?: boolean;
}) {
  return (
    <div ref={rootRef} className={`app-shell desktop-agent-page ${className}`} style={style}>
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <IconButton
            label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            className={!sidebarCollapsed ? 'is-active' : ''}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} />
          </IconButton>
          <IconButton label="Back" disabled>
            <ArrowLeft size={15} />
          </IconButton>
          <IconButton label="Forward" disabled>
            <ArrowRight size={15} />
          </IconButton>
        </div>
        <div className="app-topbar__right">
          {toolbarTitle ? <div className="chat-toolbar-title">{toolbarTitle}</div> : viewTabs}
          {status}
          {actions}
        </div>
        <div className="app-topbar__workspace">{workspaceToolbar}</div>
      </header>
      <div className={`app-workbench ${inspectorOpen ? '' : 'app-workbench--inspector-closed'}`}>{children}</div>
    </div>
  );
}
