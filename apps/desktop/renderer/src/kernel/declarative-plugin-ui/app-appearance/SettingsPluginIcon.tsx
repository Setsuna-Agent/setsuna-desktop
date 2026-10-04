import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { PluginIcon } from '../../../shared/ui/PluginIcon.js';
import { PluginAppAvatar } from './PluginAppAvatar.js';
import { usePluginAppAppearance } from './usePluginAppAppearance.js';

/** Catalog, details and sidebar apps subscribe to the same host-owned appearance. */
export function SettingsPluginIcon({ appContributionId, ...props }: SettingsPluginIconProps) {
  if (props.pluginId && appContributionId) {
    return <InstalledAppIcon {...props} pluginId={props.pluginId} appContributionId={appContributionId} />;
  }
  return <PluginIcon {...props} />;
}

function InstalledAppIcon({ appContributionId, className, pluginId, variant = 'card' }: SettingsPluginIconProps & {
  appContributionId: string;
  pluginId: string;
}) {
  const { appearance } = usePluginAppAppearance(pluginId, appContributionId);
  return <PluginAppAvatar avatar={appearance.avatar} className={className} variant={variant} />;
}
