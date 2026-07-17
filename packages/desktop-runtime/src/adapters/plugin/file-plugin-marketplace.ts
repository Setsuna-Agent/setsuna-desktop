import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginInstallResult,
  RuntimePluginMarketplaceItem,
  RuntimePluginMarketplaceList,
} from '@setsuna-desktop/contracts';
import type { PluginBundleInspection, PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { PluginMarketplace } from '../../ports/plugin-marketplace.js';

type MarketplaceBundleStore = Pick<
  PluginBundleStore,
  'inspectPlugin' | 'installPlugin' | 'listPlugins' | 'readBundleItemContent'
>;

/** Exposes app-bundled, curated plugins without leaking their filesystem location to the renderer. */
export class FilePluginMarketplace implements PluginMarketplace {
  constructor(
    private readonly catalogRoot: string,
    private readonly bundles: MarketplaceBundleStore,
  ) {}

  async listPlugins(): Promise<RuntimePluginMarketplaceList> {
    const [{ plugins: installedPlugins }, catalog] = await Promise.all([
      this.bundles.listPlugins(),
      this.readCatalog(),
    ]);
    const installedById = new Map(installedPlugins.map((plugin) => [plugin.id, plugin]));
    const plugins = catalog.plugins
      .map((plugin): RuntimePluginMarketplaceItem => {
        const installed = installedById.get(plugin.id);
        return {
          id: plugin.id,
          name: plugin.name,
          ...(plugin.icon ? { icon: plugin.icon } : {}),
          ...(plugin.version ? { version: plugin.version } : {}),
          ...(plugin.description ? { description: plugin.description } : {}),
          ...(plugin.publisher ? { publisher: plugin.publisher } : {}),
          tags: [...plugin.tags],
          featured: plugin.featured,
          skills: plugin.skills.map((skill) => ({ ...skill })),
          mcpServers: plugin.mcpServers.map((server) => ({ ...server })),
          hooks: plugin.hooks.map((hook) => ({ ...hook })),
          resources: plugin.resources.map((resource) => ({ ...resource })),
          capabilities: { ...plugin.capabilities },
          installed: Boolean(installed),
          ...(installed?.version ? { installedVersion: installed.version } : {}),
        };
      })
      .sort((left, right) => Number(right.featured) - Number(left.featured) || left.name.localeCompare(right.name, 'zh-CN'));
    return { plugins, errors: catalog.errors };
  }

  async readItemContent(
    pluginId: string,
    kind: RuntimePluginItemKind,
    itemId: string,
  ): Promise<RuntimePluginItemContent> {
    const id = pluginId.trim().toLowerCase();
    const catalog = await this.readCatalog();
    const plugin = catalog.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`Marketplace plugin not found: ${pluginId}`);
    return this.bundles.readBundleItemContent({ path: plugin.sourcePath }, kind, itemId);
  }

  async installPlugin(pluginId: string): Promise<RuntimePluginInstallResult> {
    const id = pluginId.trim().toLowerCase();
    const catalog = await this.readCatalog();
    const plugin = catalog.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`Marketplace plugin not found: ${pluginId}`);
    return this.bundles.installPlugin({ path: plugin.sourcePath });
  }

  private async readCatalog(): Promise<{ plugins: PluginBundleInspection[]; errors: string[] }> {
    const root = await realpath(this.catalogRoot).catch(() => null);
    if (!root) return { plugins: [], errors: [] };
    const entries = await readdir(root, { withFileTypes: true });
    const plugins: PluginBundleInspection[] = [];
    const errors: string[] = [];
    const seenIds = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      try {
        const plugin = await this.bundles.inspectPlugin({ path: path.join(root, entry.name) });
        if (!pathIsInside(root, plugin.sourcePath)) throw new Error('Plugin source escapes the bundled catalog.');
        if (seenIds.has(plugin.id)) throw new Error(`Duplicate marketplace plugin id: ${plugin.id}`);
        seenIds.add(plugin.id);
        plugins.push(plugin);
      } catch (error) {
        errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { plugins, errors };
  }
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
