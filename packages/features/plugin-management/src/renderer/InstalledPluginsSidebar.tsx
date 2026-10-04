import type { CapabilitiesSidebarSlotProps } from '@setsuna-desktop/renderer-contracts/capabilities';
import { useMemo, useSyncExternalStore } from 'react';
import type { PluginManagementRendererService } from '../contracts/index.js';
import type { PluginManagementTranslate } from './messages.js';
import { installedPluginCatalogId, pluginIconProps, pluginMatchesQuery } from './pluginPresentation.js';

export function InstalledPluginsSidebar({
  service,
  selectedPluginId,
  query,
  onSelectPlugin,
  translate,
  ui,
}: CapabilitiesSidebarSlotProps & Readonly<{ service: PluginManagementRendererService }>) {
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const plugins = useMemo(() => snapshot.plugins
    .filter((plugin) => pluginMatchesQuery(plugin, query))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)), [query, snapshot.plugins]);
  const t = translate as PluginManagementTranslate;
  if (!snapshot.plugins.length) return null;

  return (
    <nav aria-label={t('feature.pluginManagement.installed')}>
      <h3 className="capabilities-sidebar__group-title">{t('feature.pluginManagement.installed')}</h3>
      {plugins.map((plugin) => {
        // Repository installations use a local ID; details navigate by the catalog ID.
        const catalogId = installedPluginCatalogId(plugin);
        const active = selectedPluginId === catalogId || selectedPluginId === plugin.id;
        return (
          <ui.Button
            variant="ghost"
            className="capabilities-sidebar__item"
            key={plugin.id}
            aria-current={active ? 'page' : undefined}
            title={plugin.name}
            onClick={() => onSelectPlugin(catalogId)}
          >
            <ui.PluginIcon {...pluginIconProps(plugin)} variant="inline" />
            <span>{plugin.name}</span>
          </ui.Button>
        );
      })}
    </nav>
  );
}
