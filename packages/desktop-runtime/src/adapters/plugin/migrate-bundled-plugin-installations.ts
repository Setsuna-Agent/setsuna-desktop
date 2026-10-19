import path from 'node:path';
import type { PluginBundleInspection, PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { readJsonFile } from '../store/json-file.js';
import { requiredBundleDirectory, type PluginIndexFile } from './file-plugin-bundle-model.js';
import { sameLegacyMarketplaceSource } from './legacy-marketplace-source.js';

/** Retire obsolete built-ins and recover provenance without touching same-ID local bundles. */
export async function migrateBundledPluginInstallations(
  indexPath: string,
  bundledPluginsDir: string,
  store: Pick<PluginBundleStore, 'migrateLegacyMarketplaceInstallations' | 'removePlugin'>,
  retireObsolete: boolean,
): Promise<Set<string>> {
  // Catalog and tool reads can arrive together. Serialize migrations separately
  // from the index lock acquired by the store's normal removal transaction.
  return withFileStateUpdate(`${indexPath}.bundled-migrations`, async () => {
    const index = await readJsonFile<PluginIndexFile>(indexPath, { version: 1, plugins: [] });
    const retiredIds = new Set<string>();
    const candidates: Array<Pick<PluginBundleInspection, 'id' | 'sourcePath'>> = [];
    for (const plugin of Array.isArray(index.plugins) ? index.plugins : []) {
      const bundledSource = path.join(bundledPluginsDir, plugin.id);
      // The standalone question tool was superseded by core request_user_input.
      // Its source directory is gone, so legacy provenance must not require it to exist.
      if (plugin.id === 'question' && (
        plugin.installationSource === 'marketplace'
        || (!plugin.installationSource && await sameLegacyMarketplaceSource(plugin.sourcePath, bundledSource))
      )) {
        retiredIds.add(plugin.id);
        // Startup reads marketplace summaries to restore required built-ins.
        // Hide retired entries there; defer their uninstall to extension/tool reads.
        if (retireObsolete) {
          await store.removePlugin(plugin.id).catch((error) => {
            // A locked file must not restore the retired tool or block other plugins.
            // The normal removal transaction rolls back, so a later read can retry.
            console.warn('Could not remove retired bundled plugin question:', error);
          });
        }
        continue;
      }
      if (plugin.installationSource) continue;
      const sourcePath = await requiredBundleDirectory(bundledSource).catch(() => null);
      if (sourcePath) candidates.push({ id: plugin.id, sourcePath });
    }
    await store.migrateLegacyMarketplaceInstallations(candidates);
    return retiredIds;
  });
}
