import type {
  RuntimePluginHook,
  RuntimePluginMarketplaceItem,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginSkill,
  RuntimePluginSummary,
  RuntimePluginTool,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export type PluginMcpDetail = RuntimePluginMcpServerDescriptor & { owned?: boolean };

export type PluginMarketplaceSection = {
  id: 'automation' | 'creation' | 'featured' | 'utilities';
  title: string;
  description: string;
  plugins: RuntimePluginMarketplaceItem[];
};

export function pluginMarketplacePresentation(
  plugins: RuntimePluginMarketplaceItem[],
  t: Translate = defaultTranslate,
): { sections: PluginMarketplaceSection[] } {
  const utilities = plugins.filter(isSetsunaUtility);
  const regularPlugins = plugins.filter((plugin) => !isSetsunaUtility(plugin));
  const featured = regularPlugins.filter((plugin) => plugin.featured);
  const catalogPlugins = regularPlugins.filter((plugin) => !plugin.featured);
  const creation = catalogPlugins.filter((plugin) => !plugin.capabilities.hooks);
  const automation = catalogPlugins.filter((plugin) => plugin.capabilities.hooks > 0);
  const sections: PluginMarketplaceSection[] = [];
  if (featured.length) {
    sections.push({
      id: 'featured',
      title: t('capabilities.market.featured'),
      description: t('capabilities.market.featuredDescription'),
      plugins: featured,
    });
  }
  if (utilities.length) {
    sections.push({
      id: 'utilities',
      title: t('capabilities.market.utilities'),
      description: t('capabilities.market.utilitiesDescription'),
      plugins: utilities,
    });
  }
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
  return { sections };
}

function isSetsunaUtility(plugin: RuntimePluginMarketplaceItem): boolean {
  return plugin.publisher === 'Setsuna' && Boolean(plugin.capabilities.extension);
}

export function pluginCapabilitySummary(plugin: RuntimePluginMarketplaceItem, t: Translate = defaultTranslate): string {
  const labels = [
    plugin.capabilities.extension ? t('capabilities.market.extension') : null,
    plugin.capabilities.tools ? capabilityCountLabel('tool', plugin.capabilities.tools, t) : null,
    plugin.capabilities.skills ? capabilityCountLabel('skill', plugin.capabilities.skills, t) : null,
    plugin.capabilities.mcpServers ? capabilityCountLabel('service', plugin.capabilities.mcpServers, t) : null,
    plugin.capabilities.hooks ? capabilityCountLabel('automation', plugin.capabilities.hooks, t) : null,
    plugin.capabilities.resources ? capabilityCountLabel('resource', plugin.capabilities.resources, t) : null,
  ].filter((label): label is string => Boolean(label));
  return labels.join(' · ') || t('capabilities.market.pluginSummary');
}

function capabilityCountLabel(
  kind: 'automation' | 'resource' | 'service' | 'skill' | 'tool',
  count: number,
  t: Translate,
): string {
  return t(`capabilities.market.${kind}.${count === 1 ? 'one' : 'many'}`, { count });
}

export function mergePluginTools(
  marketplace: RuntimePluginTool[],
  installed: RuntimePluginTool[],
): RuntimePluginTool[] {
  const installedByName = new Map(installed.map((tool) => [tool.name, tool]));
  const merged = marketplace.map((tool) => {
    const active = installedByName.get(tool.name);
    installedByName.delete(tool.name);
    return active ? { ...tool, ...active, description: active.description ?? tool.description } : tool;
  });
  return [...merged, ...installedByName.values()];
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
