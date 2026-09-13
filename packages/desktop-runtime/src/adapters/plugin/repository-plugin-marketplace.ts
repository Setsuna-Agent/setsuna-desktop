import type { RuntimePluginItemKind, RuntimePluginMarketplaceList, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { PluginMarketplace, PluginMarketplaceListOptions } from '../../ports/plugin-marketplace.js';
import { bundlePathExists, pathIsInside, readPluginJson, safeExistingPath } from './file-plugin-bundle-paths.js';
import { inspectBundleTree } from './file-plugin-bundle-model.js';
import { downloadRepositoryArchive, type RepositoryFetch } from './repository-plugin-archive.js';
import { readRepositoryPluginCatalog, type RepositoryCatalogEntry } from './repository-plugin-catalog.js';

type RepositoryBundles = Pick<PluginBundleStore, 'inspectPlugin' | 'listPlugins' | 'installPlugin' | 'updatePlugin' | 'readBundleItemContent'>;

/** Pinned repository snapshots share the bundle store, but never bundled-plugin trust. */
export class RepositoryPluginMarketplace implements PluginMarketplace {
  private catalog: RepositoryCatalogEntry[] = [];
  private revision: string | undefined;
  private errors: string[] = [];
  private initialization: Promise<void> | undefined;
  private refreshFlight: Promise<void> | undefined;
  private mutationTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cacheRoot: string,
    private readonly bundles: RepositoryBundles,
    private readonly fetch: RepositoryFetch,
  ) {}

  async listPlugins(options?: PluginMarketplaceListOptions): Promise<RuntimePluginMarketplaceList> {
    const initialization = this.initialize();
    // Cache inspection can be expensive. Ordinary aggregate reads must not wait
    // for it; the page's explicit repository refresh publishes the completed catalog.
    if (options?.waitForInitialization !== false || options?.refreshRepositories) await initialization;
    if (options?.refreshRepositories) await this.refresh();
    const installed = (await this.bundles.listPlugins()).plugins;
    return {
      // Retain failure reasons internally for direct requests, but only publish
      // installable entries (including source-ownership checks) to the market.
      plugins: this.catalog.map(({ item }) => {
        const existing = installed.find((plugin) => plugin.id === item.bundleId);
        const owned = existing && repositoryOwnsPlugin(existing, item.id);
        return {
          ...item,
          ...(existing && !owned ? { unavailableReason: `Plugin id ${item.bundleId} is already installed from another source. Remove it before switching sources.` } : {}),
          installed: Boolean(owned),
          ...(owned && existing.version ? { installedVersion: existing.version } : {}),
          updateAvailable: Boolean(owned && !item.unavailableReason
            && existing.repository?.bundleHash !== item.repository?.bundleHash),
        };
      }).filter((plugin) => !plugin.unavailableReason),
      errors: [...this.errors],
    };
  }

  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string) {
    return this.serialize(async () => {
      const plugin = await this.availableEntry(pluginId);
      return this.bundles.readBundleItemContent({ path: plugin.sourcePath! }, kind, itemId);
    });
  }

  installPlugin(pluginId: string) {
    return this.mutatePlugin(pluginId, false);
  }

  updatePlugin(pluginId: string) {
    return this.mutatePlugin(pluginId, true);
  }

  private mutatePlugin(pluginId: string, update: boolean) {
    return this.serialize(async () => {
      const plugin = await this.availableEntry(pluginId);
      const installed = (await this.bundles.listPlugins()).plugins.find((item) => item.id === plugin.item.bundleId);
      if (installed && !repositoryOwnsPlugin(installed, plugin.item.id)) {
        throw new Error(`Repository plugin conflicts with another installed source: ${plugin.item.bundleId}`);
      }
      if (update && !installed) throw new Error(`Repository plugin is not installed: ${pluginId}`);
      if (update && installed?.repository?.bundleHash === plugin.item.repository?.bundleHash) {
        throw new Error(`Repository plugin update is not available: ${pluginId}`);
      }
      const options = { installationSource: 'repository' as const, repository: plugin.item.repository };
      return update
        ? this.bundles.updatePlugin({ path: plugin.sourcePath! }, options)
        : this.bundles.installPlugin({ path: plugin.sourcePath! }, options);
    });
  }

  private async availableEntry(pluginId: string): Promise<RepositoryCatalogEntry> {
    await this.initialize();
    const plugin = this.catalog.find(({ item }) => item.id === pluginId);
    if (!plugin) throw new Error(`Repository marketplace plugin not found: ${pluginId}. Refresh the repository first.`);
    if (plugin.item.unavailableReason) throw new Error(plugin.item.unavailableReason);
    if (!plugin.sourcePath || !plugin.item.repository?.bundleHash) throw new Error('Repository plugin snapshot is incomplete.');
    return plugin;
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.loadCache().catch((error: unknown) => { this.recordError(error); });
    return this.initialization;
  }

  private async loadCache(): Promise<void> {
    if (!await bundlePathExists(this.cacheRoot, 'current.json')) return;
    const current = await readPluginJson(this.cacheRoot, 'current.json');
    const revision = repositoryRevision(current.revision);
    const root = await safeExistingPath(this.cacheRoot, revision);
    this.catalog = await readRepositoryPluginCatalog(root, revision, this.bundles);
    this.revision = revision;
  }

  private refresh(): Promise<void> {
    // Page entry and a manual refresh may overlap. One download serves both callers.
    this.refreshFlight ??= this.serialize(() => this.refreshSnapshot())
      .catch((error: unknown) => { this.recordError(error); })
      .finally(() => { this.refreshFlight = undefined; });
    return this.refreshFlight;
  }

  private async refreshSnapshot(): Promise<void> {
    const response = await this.fetch('https://api.github.com/repos/openai/plugins/git/ref/heads/main', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Plugin repository refresh failed (HTTP ${response.status}).`);
    const ref = await response.json() as { object?: { sha?: unknown } };
    const revision = repositoryRevision(ref.object?.sha);
    if (revision === this.revision && await this.cacheMatchesCatalog()) { this.errors = []; return; }

    await mkdir(this.cacheRoot, { recursive: true });
    const staging = await mkdtemp(path.join(this.cacheRoot, '.download-'));
    const snapshotPath = path.join(this.cacheRoot, revision);
    try {
      const extracted = path.join(staging, 'snapshot');
      await downloadRepositoryArchive(this.fetch, revision, path.join(staging, 'repository.tar'), extracted);
      // Validate the index and all candidates before publishing a new current pointer.
      const catalog = await readRepositoryPluginCatalog(extracted, revision, this.bundles);
      await this.removeCacheDirectory(snapshotPath);
      await rename(extracted, snapshotPath);
      const pointer = path.join(staging, 'current.json');
      await writeFile(pointer, JSON.stringify({ revision }), 'utf8');
      await rename(pointer, path.join(this.cacheRoot, 'current.json'));
      this.catalog = catalog.map((entry) => ({
        ...entry,
        ...(entry.sourcePath ? { sourcePath: path.join(snapshotPath, path.relative(extracted, entry.sourcePath)) } : {}),
      }));
      this.revision = revision;
      this.errors = [];
      // Installs/previews share this queue, so no reader can still be copying an old snapshot.
      for (const entry of await readdir(this.cacheRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-f0-9]{40}$/u.test(entry.name) && entry.name !== revision) {
          await this.removeCacheDirectory(path.join(this.cacheRoot, entry.name));
        }
      }
    } finally {
      await this.removeCacheDirectory(staging);
    }
  }

  private recordError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.errors = [`openai/plugins: ${detail.split(this.cacheRoot).join('[repository cache]')}`];
  }

  private async cacheMatchesCatalog(): Promise<boolean> {
    for (const entry of this.catalog) {
      if (!entry.sourcePath || !entry.item.repository?.bundleHash) continue;
      const current = await inspectBundleTree(entry.sourcePath).catch(() => undefined);
      if (current?.bundleHash !== entry.item.repository.bundleHash) return false;
    }
    return true;
  }

  private async removeCacheDirectory(target: string): Promise<void> {
    const resolved = path.resolve(target);
    if (resolved === path.resolve(this.cacheRoot) || !pathIsInside(this.cacheRoot, resolved)) {
      throw new Error('Repository cache cleanup escaped its root.');
    }
    await rm(resolved, { recursive: true, force: true });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.catch(() => undefined);
    return result;
  }
}

function repositoryRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) throw new Error('Invalid plugin repository revision.');
  return value;
}

function repositoryOwnsPlugin(plugin: RuntimePluginSummary, marketplaceId: string): boolean {
  return plugin.installationSource === 'repository' && plugin.repository?.marketplaceId === marketplaceId;
}
