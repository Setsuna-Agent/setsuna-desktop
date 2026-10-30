import { APP_BUILDER_PLUGIN_ID, PLUGIN_BUILDER_PLUGIN_ID } from '@setsuna-desktop/contracts';
import path from 'node:path';
import { abortable } from '../../loop/core/runtime-turn-errors.js';
import type { PluginMarketplace } from '../../ports/plugin-marketplace.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';

/** Keep required built-ins installed and current, regardless of legacy one-time install markers. */
export async function installDefaultPlugins(dataDir: string, bundledMarketplace: PluginMarketplace, signal?: AbortSignal): Promise<void> {
  await withFileStateUpdate(path.join(dataDir, 'builtin-plugins'), async () => {
    signal?.throwIfAborted();
    const listing = bundledMarketplace.listPlugins({ signal });
    const catalog = await (signal ? abortable(listing, signal) : listing);
    for (const id of [APP_BUILDER_PLUGIN_ID, PLUGIN_BUILDER_PLUGIN_ID]) {
      signal?.throwIfAborted();
      const plugin = catalog.plugins.find((item) => item.id === id);
      // Custom runtime distributions may supply a different bundled catalog.
      if (!plugin) continue;
      if (!plugin.installed) await bundledMarketplace.installPlugin(plugin.id, { signal });
      else if (plugin.updateAvailable) await bundledMarketplace.updatePlugin(plugin.id, { signal });
    }
  });
}

/** Background preparation and dependent reads share one task; runtime readiness never awaits it. */
export function createBuiltinPluginInitializer(dataDir: string, marketplace: PluginMarketplace) {
  const controller = new AbortController();
  let pending: Promise<void> | null = null;
  return {
    ensureReady(): Promise<void> {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      pending ??= installDefaultPlugins(dataDir, marketplace, controller.signal).catch((error: unknown) => {
        pending = null;
        throw error;
      });
      return pending;
    },
    async stop(): Promise<void> {
      controller.abort();
      // Drain an in-flight bundle transaction before its stores and worker manager close.
      await pending?.catch(() => undefined);
    },
  };
}
