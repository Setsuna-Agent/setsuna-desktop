import { normalizeBrandIconConfig, type BrandIconConfig } from '@setsuna-desktop/contracts';
import { normalizeIconColor, type IconColor } from '../icon-colors.js';
import { isIconAvatarPresetKey } from './presets.js';

export type IconAvatarAppearance = Readonly<{
  avatar?: BrandIconConfig;
  /** Uploaded images keep their original pixels. */
  avatarColor?: IconColor;
}>;

export function normalizeIconAvatarAppearance(value: unknown): IconAvatarAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const avatar = normalizeBrandIconConfig(record.avatar);
  const avatarColor = normalizeIconColor(record.avatarColor);
  return {
    ...(avatar && (avatar.type === 'custom' || isIconAvatarPresetKey(avatar.key)) ? { avatar } : {}),
    ...(avatarColor ? { avatarColor } : {}),
  };
}
