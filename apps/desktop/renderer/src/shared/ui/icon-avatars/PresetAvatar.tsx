import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useState } from 'react';
import { IconAvatar } from '../IconAvatar.js';
import { ICON_AVATAR_PRESETS, type AvatarColor, type IconAvatarPreset } from './presets.js';

export function PresetAvatar({ avatar, color, className, variant = 'menu', presets = ICON_AVATAR_PRESETS }: Readonly<{
  avatar: BrandIconConfig;
  color?: AvatarColor;
  className?: string;
  variant?: SettingsPluginIconProps['variant'];
  presets?: readonly IconAvatarPreset[];
}>) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (avatar.type === 'custom' && avatar.dataUrl !== failedImage) {
    return <img alt="" draggable={false} src={avatar.dataUrl}
      className={['desktop-icon-avatar-image', `desktop-icon-avatar-size--${variant}`, className].filter(Boolean).join(' ')}
      onError={() => setFailedImage(avatar.dataUrl)} />;
  }
  // Saved choices from the shared catalog remain readable when a feature supplies its own presets.
  const matches = (item: IconAvatarPreset) => avatar.type === 'preset' && item.key === avatar.key;
  const preset = presets.find(matches) ?? ICON_AVATAR_PRESETS.find(matches) ?? presets[0] ?? ICON_AVATAR_PRESETS[0];
  return <IconAvatar Icon={preset.Icon} color={color ?? preset.color} className={className} variant={variant} />;
}
