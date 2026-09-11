import type {
  RuntimeInterfaceLanguage,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type PluginMessages = Readonly<Record<string, string>>;

export async function localizedPluginMarkdownPath(root: string, relativePath: string, language?: RuntimeInterfaceLanguage): Promise<string> {
  if (!language || path.extname(relativePath).toLowerCase() !== '.md') return relativePath;
  const localized = `${relativePath.slice(0, -3)}.${language}.md`;
  return (await stat(path.resolve(root, localized)).catch(() => null))?.isFile() ? localized : relativePath;
}

export async function installedPluginMessages(
  plugin: { id: string; installPath: string; installationSource?: string },
  language: RuntimeInterfaceLanguage,
  bundledPluginsDir?: string,
): Promise<PluginMessages> {
  if (plugin.installationSource !== 'marketplace') return {};
  const installed = await readBundledPluginMessages(plugin.installPath, language);
  // 旧版安装副本尚无翻译资源时，用当前应用目录的展示文案；不改写已批准的包。
  const bundled = bundledPluginsDir && /^[a-z0-9][a-z0-9._-]*$/u.test(plugin.id)
    ? await readBundledPluginMessages(path.join(bundledPluginsDir, plugin.id), language)
    : {};
  return { ...bundled, ...installed };
}

/** 仅由确认了内置来源的调用方使用；翻译不写回安装记录或参与执行的清单。 */
export async function readBundledPluginMessages(
  pluginRoot: string,
  language: RuntimeInterfaceLanguage,
): Promise<PluginMessages> {
  const content = await readFile(path.join(pluginRoot, '.setsuna-plugin', 'i18n.json'), 'utf8')
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    });
  const catalogs: unknown = JSON.parse(content);
  if (!catalogs || typeof catalogs !== 'object' || Array.isArray(catalogs)) return {};
  const messages: unknown = (catalogs as Record<string, unknown>)[language];
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) return {};
  return Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function pluginText(messages: PluginMessages, value: string): string {
  return Object.hasOwn(messages, value) ? messages[value] : value;
}

const DISPLAY_FIELDS = new Set(['description', 'label', 'title', 'message', 'text', 'placeholder', 'fallback', 'statusMessage']);
const LITERAL_FIELDS = new Set(['const', 'default', 'enum', 'examples', 'data']);

/** 只替换展示文案。工具名、参数名、枚举、路径、权限和执行配置保持原值。 */
export function localizePluginDisplayFields<T>(value: T, messages: PluginMessages): T {
  if (Array.isArray(value)) return value.map((item) => localizePluginDisplayFields(item, messages)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [
    key,
    LITERAL_FIELDS.has(key) ? field : DISPLAY_FIELDS.has(key) && typeof field === 'string'
      ? pluginText(messages, field)
      : localizePluginDisplayFields(field, messages),
  ])) as T;
}

export function localizeBundledPlugin<T extends Pick<RuntimePluginSummary | RuntimePluginMarketplaceItem,
  'name' | 'description' | 'tags' | 'skills' | 'hooks'
>>(plugin: T, messages: PluginMessages): T {
  const localized = localizePluginDisplayFields(plugin, messages);
  return {
    ...localized,
    name: pluginText(messages, plugin.name),
    ...(plugin.tags ? { tags: plugin.tags.map((tag) => pluginText(messages, tag)) } : {}),
    skills: localized.skills.map((skill) => ({ ...skill, name: pluginText(messages, skill.name) })),
    hooks: localized.hooks.map((hook) => ({ ...hook, name: pluginText(messages, hook.name) })),
  };
}
