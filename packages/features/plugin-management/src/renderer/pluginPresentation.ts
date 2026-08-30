import type {
  RuntimePluginHook,
  RuntimePluginMarketplaceItem,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginSkill,
  RuntimePluginSummary,
  RuntimePluginTool,
} from '@setsuna-desktop/contracts';
import type { PluginManagementHook } from '../contracts/index.js';

export type PluginMcpDetail = RuntimePluginMcpServerDescriptor & Readonly<{ owned?: boolean }>;

export function installedPluginsOutsideCatalog(
  installed: readonly RuntimePluginSummary[],
  marketplace: readonly RuntimePluginMarketplaceItem[],
): RuntimePluginSummary[] {
  const catalogIds = new Set(marketplace.map((plugin) => plugin.id));
  return installed.filter((plugin) => (
    plugin.installationSource !== 'marketplace' || !catalogIds.has(plugin.id)
  ));
}

export function pluginMatchesQuery(
  plugin: RuntimePluginMarketplaceItem | RuntimePluginSummary,
  query: string,
  installed?: RuntimePluginSummary,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [plugin, installed]
    .filter((candidate): candidate is RuntimePluginMarketplaceItem | RuntimePluginSummary => Boolean(candidate))
    .flatMap(searchablePluginValues)
    .some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function mergePluginTools(
  catalog: readonly RuntimePluginTool[],
  installed: readonly RuntimePluginTool[],
  includeCatalogOnly: boolean,
): RuntimePluginTool[] {
  return mergeByKey(catalog, installed, (item) => item.name, includeCatalogOnly);
}

export function mergePluginSkills(
  catalog: readonly RuntimePluginSkill[],
  installed: readonly RuntimePluginSkill[],
  includeCatalogOnly: boolean,
): RuntimePluginSkill[] {
  return mergeByKey(catalog, installed, (item) => item.id, includeCatalogOnly);
}

export function mergePluginMcpServers(
  catalog: readonly RuntimePluginMcpServerDescriptor[],
  installed: readonly PluginMcpDetail[],
  includeCatalogOnly: boolean,
): PluginMcpDetail[] {
  return mergeByKey(catalog, installed, (item) => item.key, includeCatalogOnly);
}

export function mergePluginHooks(
  catalog: readonly RuntimePluginHook[],
  installed: readonly RuntimePluginHook[],
  includeCatalogOnly: boolean,
): RuntimePluginHook[] {
  return mergeByKey(catalog, installed, (item) => item.id, includeCatalogOnly);
}

export function matchingPluginHook(
  hooks: readonly PluginManagementHook[],
  pluginId: string,
  item: RuntimePluginHook,
): PluginManagementHook | undefined {
  const exact = hooks.find((hook) => (
    hook.pluginId === pluginId && hook.pluginHookId === item.id
  ));
  if (exact) return exact;

  const eventName = `${item.eventName[0].toLocaleLowerCase()}${item.eventName.slice(1)}`;
  const legacyCandidates = hooks.filter((hook) => (
    hook.pluginId === pluginId
    && !hook.pluginHookId
    && hook.eventName === eventName
    && (hook.matcher ?? '') === (item.matcher ?? '')
  ));
  // Pre-pluginHookId installs can only be managed when the old tuple is unambiguous.
  return legacyCandidates.length === 1 ? legacyCandidates[0] : undefined;
}

export function formatPluginFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(0.1, size / 1024).toFixed(1)} KB`;
  return `${Math.max(0.1, size / (1024 * 1024)).toFixed(1)} MB`;
}

function searchablePluginValues(
  plugin: RuntimePluginMarketplaceItem | RuntimePluginSummary,
): string[] {
  return [
    plugin.id,
    plugin.name,
    plugin.description ?? '',
    plugin.publisher ?? '',
    ...(plugin.tags ?? []),
    ...(plugin.tools ?? []).flatMap((tool) => [tool.name, tool.description ?? '']),
    ...plugin.skills.flatMap((skill) => [skill.id, skill.name, skill.description ?? '']),
    ...plugin.mcpServers.flatMap((server) => [server.key, server.label, server.description ?? '']),
    ...plugin.hooks.flatMap((hook) => [hook.id, hook.name, hook.description ?? '']),
    ...plugin.resources.flatMap((resource) => [resource.id, resource.label, resource.path]),
  ];
}

function mergeByKey<T>(
  catalog: readonly T[],
  installed: readonly T[],
  keyOf: (item: T) => string,
  includeCatalogOnly: boolean,
): T[] {
  const installedByKey = new Map(installed.map((item) => [keyOf(item), item]));
  const merged = catalog.flatMap((item) => {
    const active = installedByKey.get(keyOf(item));
    if (!active && !includeCatalogOnly) return [];
    installedByKey.delete(keyOf(item));
    return [{ ...item, ...active }];
  });
  return [...merged, ...installedByKey.values()];
}
