import type {
  RuntimePluginMcpServerDescriptor,
  RuntimePluginHook,
  RuntimePluginMarketplaceItem,
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

export type PluginMarketplaceSection = {
  id: 'automation' | 'creation' | 'results';
  title: string;
  description: string;
  plugins: RuntimePluginMarketplaceItem[];
};

export function pluginMarketplacePresentation(
  plugins: RuntimePluginMarketplaceItem[],
  searching: boolean,
): { editorials: RuntimePluginMarketplaceItem[]; sections: PluginMarketplaceSection[] } {
  if (searching) {
    return {
      editorials: [],
      sections: plugins.length ? [{
        id: 'results',
        title: '搜索结果',
        description: `找到 ${plugins.length} 个匹配插件`,
        plugins,
      }] : [],
    };
  }

  const featured = plugins.filter((plugin) => plugin.featured);
  const fallback = plugins.filter((plugin) => !plugin.featured);
  const editorials = [...featured, ...fallback].slice(0, 2);
  const creation = plugins.filter((plugin) => !plugin.capabilities.hooks);
  const automation = plugins.filter((plugin) => plugin.capabilities.hooks > 0);
  const sections: PluginMarketplaceSection[] = [];
  if (creation.length) {
    sections.push({
      id: 'creation',
      title: '创作与知识',
      description: '文档、内容处理与开发知识',
      plugins: creation,
    });
  }
  if (automation.length) {
    sections.push({
      id: 'automation',
      title: '安全与自动化',
      description: '按需安装的本地 Hook 工作流',
      plugins: automation,
    });
  }
  return { editorials, sections };
}

export function pluginCapabilitySummary(plugin: RuntimePluginMarketplaceItem): string {
  const labels = [
    plugin.capabilities.skills ? `${plugin.capabilities.skills} 个技能` : null,
    plugin.capabilities.mcpServers ? `${plugin.capabilities.mcpServers} 个服务` : null,
    plugin.capabilities.hooks ? `${plugin.capabilities.hooks} 项自动化` : null,
    plugin.capabilities.resources ? `${plugin.capabilities.resources} 个资源` : null,
  ].filter((label): label is string => Boolean(label));
  return labels.join(' · ') || 'Setsuna 插件';
}

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
