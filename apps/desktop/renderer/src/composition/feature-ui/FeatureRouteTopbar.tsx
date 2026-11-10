import type { IconButtonProps } from '@setsuna-desktop/renderer-ui';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { ActionTooltip, IconButton } from '../../shared/ui/primitives.js';

export type FeatureRouteTopbarProps = Readonly<{
  title: string;
  actions: readonly (IconButtonProps & { id: string })[];
}>;

/** Feature routes own their actions; ShellFrame places this in the macOS titlebar or Windows content header. */
export function FeatureRouteTopbar({ title, actions }: FeatureRouteTopbarProps) {
  return (
    <AppRouteTopbarPortal>
      <div className="app-topbar__route-content">
        <span className="chat-toolbar-title" title={title}>{title}</span>
        {actions.map(({ id, label, ...props }) => (
          <ActionTooltip key={id} title={label}>
            <IconButton {...props} label={label} title="" className="app-shell-icon-control" />
          </ActionTooltip>
        ))}
      </div>
    </AppRouteTopbarPortal>
  );
}
