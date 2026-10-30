import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useState } from 'react';
import { IconAvatar } from '../IconAvatar.js';
import { ICON_AVATAR_PRESETS, type AvatarColor } from './presets.js';

export function PresetAvatar({ avatar, color, className, variant = 'menu' }: Readonly<{
  avatar: BrandIconConfig;
  color?: AvatarColor;
  className?: string;
  variant?: SettingsPluginIconProps['variant'];
}>) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (avatar.type === 'custom' && avatar.dataUrl !== failedImage) {
    return <img alt="" draggable={false} src={avatar.dataUrl}
      className={['desktop-icon-avatar-image', `desktop-icon-avatar-size--${variant}`, className].filter(Boolean).join(' ')}
      onError={() => setFailedImage(avatar.dataUrl)} />;
  }
  const preset = ICON_AVATAR_PRESETS.find((item) => avatar.type === 'preset' && item.key === avatar.key) ?? ICON_AVATAR_PRESETS[0];
  return <IconAvatar Icon={preset.Icon} color={color ?? preset.color} className={className} variant={variant} />;
}
