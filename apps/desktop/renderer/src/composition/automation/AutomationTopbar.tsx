import type { AutomationToolbarProps } from '@setsuna-desktop/feature-automation/renderer';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { IconButton } from '../../shared/ui/primitives.js';

/** ShellFrame places this in the macOS titlebar or Windows content header. */
export function AutomationTopbar({ title, actions }: AutomationToolbarProps) {
  return (
    <AppRouteTopbarPortal>
      <div className="app-topbar__route-content">
        <span className="chat-toolbar-title" title={title}>{title}</span>
        {actions.map(({ id, ...props }) => (
          <IconButton key={id} {...props} className="app-shell-icon-control" />
        ))}
      </div>
    </AppRouteTopbarPortal>
  );
}
