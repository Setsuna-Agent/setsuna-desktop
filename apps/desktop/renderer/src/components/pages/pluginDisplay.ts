import type {
  RuntimePluginMcpServerDescriptor,
  RuntimePluginHook,
  RuntimePluginSkill,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';

type SearchablePlugin = {
  name: string;
  description?: string;
  publisher?: string;
  tags?: string[];
  skills: Array<Pick<RuntimePluginSkill, 'name' | 'description'>>;
  mcpServers: Array<Pick<RuntimePluginMcpServerDescriptor, 'label' | 'description'>>;
  hooks?: Array<Pick<RuntimePluginHook, 'name' | 'description' | 'eventName' | 'matcher'>>;
};

export type PluginMcpDetail = RuntimePluginMcpServerDescriptor & { owned?: boolean };

export function pluginMatchesQuery(plugin: SearchablePlugin, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const searchText = [
    plugin.name,
    plugin.description,
    plugin.publisher,
    ...(plugin.tags ?? []),
    ...plugin.skills.flatMap((skill) => [skill.name, skill.description]),
    ...plugin.mcpServers.flatMap((server) => [server.label, server.description]),
    ...(plugin.hooks ?? []).flatMap((hook) => [hook.name, hook.description, hook.eventName, hook.matcher]),
  ].filter(Boolean).join(' ').toLowerCase();
  return searchText.includes(normalizedQuery);
}

export function mergePluginHooks(
  marketplace: RuntimePluginHook[],
  installed: RuntimePluginHook[],
): RuntimePluginHook[] {
  const installedById = new Map(installed.map((hook) => [hook.id, hook]));
  const merged = marketplace.map((hook) => {
    const active = installedById.get(hook.id);
    installedById.delete(hook.id);
    return active ? { ...hook, ...active, description: active.description ?? hook.description } : hook;
  });
  return [...merged, ...installedById.values()];
}

export function mergePluginSkills(
  marketplace: RuntimePluginSkill[],
  installed: RuntimePluginSkill[],
): RuntimePluginSkill[] {
  const installedById = new Map(installed.map((skill) => [skill.id, skill]));
  const merged = marketplace.map((skill) => {
    const active = installedById.get(skill.id);
    installedById.delete(skill.id);
    return active ? { ...skill, ...active, description: active.description ?? skill.description } : skill;
  });
  return [...merged, ...installedById.values()];
}

export function mergePluginMcpServers(
  marketplace: RuntimePluginMcpServerDescriptor[],
  installed: RuntimePluginSummary['mcpServers'],
): PluginMcpDetail[] {
  const installedByKey = new Map(installed.map((server) => [server.key, server]));
  const merged = marketplace.map((server) => {
    const active = installedByKey.get(server.key);
    installedByKey.delete(server.key);
    return active ? { ...server, ...active, description: active.description ?? server.description } : server;
  });
  return [...merged, ...installedByKey.values()];
}
