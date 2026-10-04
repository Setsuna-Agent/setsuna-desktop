import { APP_BUILDER_PLUGIN_ID } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { PluginMarketplace } from '../../ports/plugin-marketplace.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';

/** Keep required built-ins installed and current, regardless of legacy one-time install markers. */
export async function installDefaultPlugins(dataDir: string, bundledMarketplace: PluginMarketplace): Promise<void> {
  await withFileStateUpdate(path.join(dataDir, 'builtin-plugins'), async () => {
    const catalog = await bundledMarketplace.listPlugins();
    const plugin = catalog.plugins.find((item) => item.id === APP_BUILDER_PLUGIN_ID);
    // Custom runtime distributions may supply a different bundled catalog.
    if (!plugin) return;
    if (!plugin.installed) await bundledMarketplace.installPlugin(plugin.id);
    else if (plugin.updateAvailable) await bundledMarketplace.updatePlugin(plugin.id);
  });
}
