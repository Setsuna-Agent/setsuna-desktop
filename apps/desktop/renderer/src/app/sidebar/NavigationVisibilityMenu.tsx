import { shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { Dropdown, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { usePluginManagementFeatureSnapshot } from '../../composition/PluginManagementFeatureBoundary.js';
import { usePluginAppCatalog } from '../../kernel/declarative-plugin-ui/app-appearance/usePluginAppCatalog.js';
import { rendererPluginSidebarEntryId } from '../../kernel/declarative-plugin-ui/plugin-identity.js';
import { useRendererOwnedSlots } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { PresetAvatar } from '../../shared/ui/icon-avatars/PresetAvatar.js';
import { AppTooltip, Button } from '../../shared/ui/primitives.js';
import { AppNavigationIcon, type AppNavigationIconName } from '../layout/AppNavigationIcon.js';

const noPlugins = [] as const;

export function NavigationVisibilityMenu({ routes, hiddenEntries, onToggle }: Readonly<{
  routes: readonly { icon: AppNavigationIconName; label: string }[];
  hiddenEntries: ReadonlySet<string>;
  onToggle(id: string): void;
}>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { plugins } = usePluginManagementFeatureSnapshot();
  const apps = usePluginAppCatalog(open ? plugins : noPlugins);
  const slots = useRendererOwnedSlots();
  const label = t('sidebar.customizeNavigation');
  const items: MenuItem[] = [{
    key: 'built-in', type: 'group', label: t('sidebar.navigationBuiltIn'),
    children: routes.map(({ icon, label }) => ({
      key: icon, label, icon: <AppNavigationIcon name={icon} active={false} />, checked: !hiddenEntries.has(icon),
    })),
  }];

  if (apps.length) {
    const byEntryId = new Map(apps.map((app) => [rendererPluginSidebarEntryId(app.pluginId, app.contributionId), app]));
    const appItems = slots.listEntryIds(shellSidebarPluginEntrySlot).flatMap<MenuItem>((id) => {
      const app = byEntryId.get(id);
      return app ? [{
        key: id, label: app.name, icon: <PresetAvatar avatar={app.avatar} color={app.avatarColor} />,
        checked: !hiddenEntries.has(id),
      }] : [];
    });
    if (appItems.length) items.push({ key: 'app-separator', type: 'divider' }, {
      key: 'custom-apps', type: 'group', label: t('sidebar.navigationCustomApps'), children: appItems,
    });
  }

  return <AppTooltip title={label} placement="right" disabled={open}>
    <Dropdown placement="rightTop" open={open} onOpenChange={setOpen} menu={{ items, onClick: ({ key }) => onToggle(key) }}>
      <Button variant="ghost" className="app-navigation__button" type="button" aria-label={label}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </Button>
    </Dropdown>
  </AppTooltip>;
}
