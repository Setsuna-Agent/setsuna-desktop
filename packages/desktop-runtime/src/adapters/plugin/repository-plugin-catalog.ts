import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import { inspectBundleTree } from './file-plugin-bundle-model.js';
import { readCodexPluginIcon } from './codex-plugin-icon.js';
import { readPluginJson, safeExistingPath, safeRelativePath } from './file-plugin-bundle-paths.js';
import { objectRecord, optionalString, requiredString } from './file-plugin-bundle-values.js';
import { OPENAI_PLUGIN_INDEX, OPENAI_PLUGIN_MARKETPLACE_PREFIX, OPENAI_PLUGIN_REPOSITORY } from './repository-plugin-archive.js';

// These providers require app registration or client approval that Setsuna has
// not completed. Keep them out of the default market, including cached indexes.
// GitHub already has a registered Setsuna app; local imports stay user-managed.
const REGISTRATION_REQUIRED_PLUGINS = new Set([
  'canva', 'figma', 'monday-com', 'vercel',
  'dropbox', 'gmail', 'google-calendar', 'google-drive', 'slack', 'zoom',
]);

export type RepositoryCatalogEntry = {
  item: RuntimePluginMarketplaceItem;
  sourcePath?: string;
};

/** Apply Setsuna's catalog selection to the published index before inspection. */
export async function readRepositoryPluginCatalog(
  root: string,
  revision: string,
  bundles: Pick<PluginBundleStore, 'inspectPlugin'>,
): Promise<RepositoryCatalogEntry[]> {
  const index = await readPluginJson(root, OPENAI_PLUGIN_INDEX);
  if (!Array.isArray(index.plugins) || !index.plugins.length || index.plugins.length > 500) {
    throw new Error('Plugin repository marketplace index must contain 1–500 plugins.');
  }
  const seen = new Set<string>();
  const catalog: RepositoryCatalogEntry[] = [];
  for (const value of index.plugins) {
    const entry = objectRecord(value, 'Invalid repository marketplace entry.');
    const name = requiredString(entry.name, 'Repository plugin name');
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name) || seen.has(name)) throw new Error(`Invalid or duplicate repository plugin name: ${name}`);
    seen.add(name);
    if (REGISTRATION_REQUIRED_PLUGINS.has(name)) continue;
    const source = objectRecord(entry.source, 'Repository plugin source must be an object.');
    const id = `${OPENAI_PLUGIN_MARKETPLACE_PREFIX}${name}`;
    const item: RuntimePluginMarketplaceItem = {
      id, bundleId: name, name,
      repository: { marketplaceId: id, url: OPENAI_PLUGIN_REPOSITORY, path: '', revision },
      tags: optionalString(entry.category) ? [String(entry.category)] : [],
      featured: false, skills: [], mcpServers: [], hooks: [], resources: [],
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
      installed: false, updateAvailable: false,
    };
    let sourcePath: string | undefined;
    try {
      if (source.source !== 'local') throw new Error('This plugin is hosted outside openai/plugins; external repository sources are not supported yet.');
      const relativePath = safeRelativePath(requiredString(source.path, 'Repository plugin path'), 'Repository plugin path');
      const portablePath = relativePath.split(path.sep).join('/');
      if (!portablePath.startsWith('plugins/')) throw new Error('Repository plugin source must be inside plugins/.');
      item.repository!.path = portablePath;
      sourcePath = await safeExistingPath(root, relativePath);
      const manifest = await readPluginJson(sourcePath, '.codex-plugin/plugin.json');
      const presentation = manifest.interface === undefined ? {} : objectRecord(manifest.interface, 'Invalid plugin interface.');
      const author = manifest.author === undefined ? {} : objectRecord(manifest.author, 'Invalid plugin author.');
      item.name = optionalString(presentation.displayName) ?? name;
      item.iconImage = await readCodexPluginIcon(sourcePath, presentation);
      item.description = optionalString(manifest.description) ?? optionalString(presentation.shortDescription);
      item.version = optionalString(manifest.version);
      item.publisher = optionalString(author.name);
      const policy = entry.policy === undefined ? {} : objectRecord(entry.policy, 'Invalid marketplace policy.');
      if (policy.installation !== undefined && policy.installation !== 'AVAILABLE') {
        throw new Error(`Repository installation policy: ${String(policy.installation)}.`);
      }
      const plugin = await bundles.inspectPlugin({ path: sourcePath });
      if (plugin.id !== name) throw new Error('Plugin manifest name does not match its marketplace entry.');
      // Repository plugins never gain the host privileges reserved for bundled extensions.
      if (plugin.extension || plugin.hooks.length || plugin.tools?.length) {
        throw new Error('Repository plugins currently support Skills, MCP and connector declarations only.');
      }
      const { bundleHash } = await inspectBundleTree(sourcePath);
      Object.assign(item, {
        description: plugin.description,
        connectors: plugin.connectors,
        skills: plugin.skills, mcpServers: plugin.mcpServers, unsupportedApps: plugin.unsupportedApps,
        unsupportedComponents: plugin.unsupportedComponents,
        tags: [...new Set([...item.tags, ...plugin.tags])], capabilities: plugin.capabilities,
        repository: { ...item.repository, bundleHash },
      });
    } catch (error) {
      item.unavailableReason = (error instanceof Error ? error.message : String(error)).split(root).join('[repository]');
    }
    catalog.push({ item, sourcePath });
  }
  return catalog.sort((left, right) => Number(Boolean(left.item.unavailableReason)) - Number(Boolean(right.item.unavailableReason))
    || left.item.name.localeCompare(right.item.name));
}
