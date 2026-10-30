import type { RuntimePluginItemKind } from '@setsuna-desktop/contracts';
import type { PluginMarketplace, PluginMarketplaceListOptions } from '../../ports/plugin-marketplace.js';
import { OPENAI_PLUGIN_MARKETPLACE_PREFIX } from './repository-plugin-archive.js';

/** Route qualified repository keys without changing installed bundle ids. */
export class CompositePluginMarketplace implements PluginMarketplace {
  constructor(private readonly bundled: PluginMarketplace, private readonly repository: PluginMarketplace) {}

  async listPlugins(options?: PluginMarketplaceListOptions) {
    const catalogs = await Promise.allSettled([
      this.bundled.listPlugins(options),
      this.repository.listPlugins({
        ...options,
        waitForInitialization: options?.waitForInitialization ?? Boolean(options?.refreshRepositories),
      }),
    ]);
    return {
      plugins: catalogs.flatMap((result) => result.status === 'fulfilled' ? result.value.plugins : []),
      errors: catalogs.flatMap((result, index) => result.status === 'fulfilled' ? result.value.errors : [
        `${index === 0 ? 'Bundled plugins' : 'openai/plugins'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      ]),
    };
  }

  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string) {
    return this.source(pluginId).readItemContent(pluginId, kind, itemId);
  }

  installPlugin(pluginId: string, options?: { signal?: AbortSignal }) {
    return this.source(pluginId).installPlugin(pluginId, options);
  }

  updatePlugin(pluginId: string, options?: { signal?: AbortSignal }) {
    return this.source(pluginId).updatePlugin(pluginId, options);
  }

  private source(pluginId: string): PluginMarketplace {
    return pluginId.startsWith(OPENAI_PLUGIN_MARKETPLACE_PREFIX) ? this.repository : this.bundled;
  }
}
