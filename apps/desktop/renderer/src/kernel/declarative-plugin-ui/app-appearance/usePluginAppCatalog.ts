import type { BrandIconConfig, RuntimePluginAppReference, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { readBrowserStorageValue } from '../../../shared/preferences/browserStorage.js';
import { fallbackAppAvatar } from './app-avatar-presets.js';
import { parsePluginAppAppearance, pluginAppAppearanceKey } from './preferences.js';
import { subscribePluginAppAppearances } from './usePluginAppAppearance.js';

export type PluginAppCandidate = RuntimePluginAppReference & { avatar: BrandIconConfig };

/** Same trusted page contributions and appearance preferences used by the sidebar. */
export function usePluginAppCatalog(plugins: readonly RuntimePluginSummary[]): PluginAppCandidate[] {
  const pages = useMemo(() => plugins.flatMap((plugin) => plugin.extension?.trust === 'trusted'
    ? (plugin.extension.rendererUi?.contributions ?? []).filter((page) => page.slot === 'renderer.plugin.page')
      .map((page) => ({ pluginId: plugin.id, contributionId: page.id, name: page.navigation?.label ?? plugin.name }))
    : []), [plugins]);
  // Serialized snapshots stay stable between storage notifications.
  const getSnapshot = useCallback(() => JSON.stringify(pages.map((page) =>
    readBrowserStorageValue(pluginAppAppearanceKey(page.pluginId, page.contributionId)))), [pages]);
  const raw = useSyncExternalStore(subscribePluginAppAppearances, getSnapshot, () => '[]');
  return useMemo(() => {
    const preferences: (string | null)[] = JSON.parse(raw);
    return pages.map((page, index) => {
      const appearance = parsePluginAppAppearance(preferences[index] ?? null);
      return { ...page, name: appearance.name ?? page.name,
        avatar: appearance.avatar ?? fallbackAppAvatar(pluginAppAppearanceKey(page.pluginId, page.contributionId)) };
    });
  }, [pages, raw]);
}
