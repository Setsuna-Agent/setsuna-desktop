import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Button, Tooltip } from '@setsuna-desktop/renderer-ui';
import { DefaultPluginIcon, PluginIcon, type PluginIconFallback } from '../../../shared/ui/PluginIcon.js';
import type { IconColor } from '../../../shared/ui/icon-colors.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { PresetAvatar } from '../../../shared/ui/icon-avatars/PresetAvatar.js';
import { usePluginAppAppearance } from './usePluginAppAppearance.js';
import './plugin-icon.css';

const PluginIconDialog = lazy(() => import('./PluginIconDialog.js'));

/** Plugin overrides take priority; an existing app avatar remains the default in settings. */
export function SettingsPluginIcon({ appContributionId, editable, ...props }: SettingsPluginIconProps) {
  const renderDefault: PluginIconFallback = (color) => props.pluginId && appContributionId
    ? <InstalledAppIcon {...props} pluginId={props.pluginId} appContributionId={appContributionId} color={color} />
    : <DefaultPluginIcon {...props} color={color} />;
  const icon = <PluginIcon {...props} renderDefault={renderDefault} />;
  return editable && props.pluginId
    ? <EditablePluginIcon pluginId={props.pluginId} renderDefault={renderDefault}>{icon}</EditablePluginIcon>
    : icon;
}

function EditablePluginIcon({ children, pluginId, renderDefault }: Readonly<{
  children: ReactNode;
  pluginId: string;
  renderDefault: PluginIconFallback;
}>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <Tooltip title={t('pluginUi.editPluginIcon')}>
      <Button type="button" variant="ghost" className="plugin-icon-edit-button"
        aria-label={t('pluginUi.editPluginIcon')} onClick={() => setOpen(true)}>{children}</Button>
    </Tooltip>
    {open ? <Suspense fallback={null}>
      <PluginIconDialog key={pluginId} pluginId={pluginId} renderDefault={renderDefault} onClose={() => setOpen(false)} />
    </Suspense> : null}
  </>;
}

function InstalledAppIcon({ appContributionId, className, pluginId, variant = 'card', color }: SettingsPluginIconProps & {
  appContributionId: string;
  pluginId: string;
  color?: IconColor;
}) {
  const { appearance } = usePluginAppAppearance(pluginId, appContributionId);
  return <PresetAvatar avatar={appearance.avatar} color={color ?? appearance.avatarColor} className={className} variant={variant} />;
}
