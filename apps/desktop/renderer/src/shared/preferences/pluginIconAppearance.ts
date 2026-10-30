import { normalizeIconAvatarAppearance, type IconAvatarAppearance } from '../ui/icon-avatars/appearance.js';
import { writeStorageValue } from './browserStorage.js';

/** User-owned icon overrides never mutate plugin bundles or their trust hashes. */
export function pluginIconAppearanceKey(pluginId: string): string {
  return `setsuna.plugin-icon:${JSON.stringify(pluginId)}`;
}

export function parsePluginIconAppearance(raw: string | null): IconAvatarAppearance {
  try {
    return normalizeIconAvatarAppearance(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function writePluginIconAppearance(
  storage: Pick<Storage, 'setItem'> | null,
  pluginId: string,
  appearance: IconAvatarAppearance,
): boolean {
  return writeStorageValue(storage, pluginIconAppearanceKey(pluginId), JSON.stringify(normalizeIconAvatarAppearance(appearance)));
}
