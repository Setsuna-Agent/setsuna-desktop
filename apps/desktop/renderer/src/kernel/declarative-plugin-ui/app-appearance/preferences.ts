import { normalizeIconAvatarAppearance, type IconAvatarAppearance } from '../../../shared/ui/icon-avatars/appearance.js';
import { writeStorageValue } from '../../../shared/preferences/browserStorage.js';

export type PluginAppAppearance = IconAvatarAppearance & Readonly<{
  name?: string;
}>;

export const PLUGIN_APP_NAME_MAX_LENGTH = 100;

/** Host-owned preferences survive bundle updates without changing Plugin trust or source files. */
export function pluginAppAppearanceKey(pluginId: string, contributionId: string): string {
  return `setsuna.plugin-app-appearance:${JSON.stringify([pluginId, contributionId])}`;
}

export function parsePluginAppAppearance(raw: string | null): PluginAppAppearance {
  if (!raw) return {};
  try {
    return normalizePluginAppAppearance(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writePluginAppAppearance(
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  appearance: PluginAppAppearance,
): boolean {
  return writeStorageValue(storage, key, JSON.stringify(normalizePluginAppAppearance(appearance)));
}

function normalizePluginAppAppearance(value: unknown): PluginAppAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  return {
    ...normalizeIconAvatarAppearance(record),
    ...(name && name.length <= PLUGIN_APP_NAME_MAX_LENGTH ? { name } : {}),
  };
}
