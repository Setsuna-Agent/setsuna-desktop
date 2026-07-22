import type {
  RuntimePluginHook,
  RuntimePluginMarketplaceItem,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginResource,
  RuntimePluginSkill,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

type SearchablePlugin = {
  name: string;
  description?: string;
  publisher?: string;
  tags?: string[];
  skills: Array<Pick<RuntimePluginSkill, 'name' | 'description'>>;
  mcpServers: Array<Pick<RuntimePluginMcpServerDescriptor, 'label' | 'description'>>;
  hooks?: Array<Pick<RuntimePluginHook, 'name' | 'description' | 'eventName' | 'matcher'>>;
  resources?: Array<Pick<RuntimePluginResource, 'label' | 'path'>>;
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
  t: Translate = defaultTranslate,
): { editorials: RuntimePluginMarketplaceItem[]; sections: PluginMarketplaceSection[] } {
  if (searching) {
    return {
      editorials: [],
      sections: plugins.length ? [{
        id: 'results',
        title: t('capabilities.market.searchResults'),
        description: t('capabilities.market.searchFound', { count: plugins.length }),
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
      title: t('capabilities.market.creation'),
      description: t('capabilities.market.creationDescription'),
      plugins: creation,
    });
  }
  if (automation.length) {
    sections.push({
      id: 'automation',
      title: t('capabilities.market.automation'),
      description: t('capabilities.market.automationDescription'),
      plugins: automation,
    });
  }
  return { editorials, sections };
}

export function pluginCapabilitySummary(plugin: RuntimePluginMarketplaceItem, t: Translate = defaultTranslate): string {
  const labels = [
    plugin.capabilities.skills ? capabilityCountLabel('skill', plugin.capabilities.skills, t) : null,
    plugin.capabilities.mcpServers ? capabilityCountLabel('service', plugin.capabilities.mcpServers, t) : null,
    plugin.capabilities.hooks ? capabilityCountLabel('automation', plugin.capabilities.hooks, t) : null,
    plugin.capabilities.resources ? capabilityCountLabel('resource', plugin.capabilities.resources, t) : null,
  ].filter((label): label is string => Boolean(label));
  return labels.join(' · ') || t('capabilities.market.pluginSummary');
}

export function pluginMatchesQuery(plugin: SearchablePlugin, normalizedQuery: string, aliases: readonly string[] = []): boolean {
  if (!normalizedQuery) return true;
  const searchText = [
    plugin.name,
    plugin.description,
    plugin.publisher,
    ...(plugin.tags ?? []),
    ...plugin.skills.flatMap((skill) => [skill.name, skill.description]),
    ...plugin.mcpServers.flatMap((server) => [server.label, server.description]),
    ...(plugin.hooks ?? []).flatMap((hook) => [hook.name, hook.description, hook.eventName, hook.matcher]),
    ...(plugin.resources ?? []).flatMap((resource) => [resource.label, resource.path]),
    ...aliases,
  ].filter(Boolean).join(' ').toLowerCase();
  return searchText.includes(normalizedQuery);
}

function capabilityCountLabel(
  kind: 'automation' | 'resource' | 'service' | 'skill',
  count: number,
  t: Translate,
): string {
  return t(`capabilities.market.${kind}.${count === 1 ? 'one' : 'many'}`, { count });
}

export function formatPluginFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
