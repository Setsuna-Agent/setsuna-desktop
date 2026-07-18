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
  'inspectPlugin' | 'installPlugin' | 'listPlugins' | 'readBundleItemContent' | 'updatePlugin'
>;

/** 暴露应用内置的精选插件，同时不向渲染进程泄露其文件系统位置。 */
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
      .sort(compareMarketplacePlugins)
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
          updateAvailable: isVersionGreater(plugin.version, installed?.version),
        };
      });
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
    // readCatalog 已把来源限制在应用内置目录；用户点击安装就是对这份随包插件的授权。
    return this.bundles.installPlugin({ path: plugin.sourcePath }, { trustHooks: true });
  }

  async updatePlugin(pluginId: string): Promise<RuntimePluginInstallResult> {
    const id = pluginId.trim().toLowerCase();
    const [{ plugins: installedPlugins }, catalog] = await Promise.all([
      this.bundles.listPlugins(),
      this.readCatalog(),
    ]);
    const plugin = catalog.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`Marketplace plugin not found: ${pluginId}`);
    const installed = installedPlugins.find((item) => item.id === id);
    if (!installed) throw new Error(`Marketplace plugin is not installed: ${pluginId}`);
    if (!isVersionGreater(plugin.version, installed.version)) {
      throw new Error(`Marketplace plugin update is not available: ${pluginId}`);
    }
    return this.bundles.updatePlugin({ path: plugin.sourcePath }, { trustHooks: true });
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

function compareMarketplacePlugins(left: PluginBundleInspection, right: PluginBundleInspection): number {
  return Number(right.featured) - Number(left.featured)
    || (left.featuredOrder ?? Number.MAX_SAFE_INTEGER) - (right.featuredOrder ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name, 'zh-CN');
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

type ParsedVersion = {
  core: string[];
  prerelease: string[] | null;
};

/** Compare version-like manifest values without treating 1.10 as older than 1.9. */
function isVersionGreater(candidate: string | undefined, installed: string | undefined): boolean {
  if (!candidate || !installed) return false;
  const left = parseVersion(candidate);
  const right = parseVersion(installed);
  if (!left || !right) return false;

  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const comparison = compareNumericIdentifier(left.core[index] ?? '0', right.core[index] ?? '0');
    if (comparison !== 0) return comparison > 0;
  }

  if (!left.prerelease && right.prerelease) return true;
  if (left.prerelease && !right.prerelease) return false;
  if (!left.prerelease || !right.prerelease) return false;

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return false;
    if (rightPart === undefined) return true;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftPart, rightPart) > 0;
    if (leftNumeric !== rightNumeric) return !leftNumeric;
    return leftPart > rightPart;
  }
  return false;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u);
  if (!match) return null;
  return {
    core: match[1].split('.'),
    prerelease: match[2]?.split('.') ?? null,
  };
}

function compareNumericIdentifier(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, '');
  const normalizedRight = right.replace(/^0+(?=\d)/u, '');
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length - normalizedRight.length;
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}
