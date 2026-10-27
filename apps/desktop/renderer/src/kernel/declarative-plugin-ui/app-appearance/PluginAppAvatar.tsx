import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useState } from 'react';
import { IconAvatar } from '../../../shared/ui/IconAvatar.js';
import { APP_AVATAR_PRESETS, type AppAvatarColor } from './app-avatar-presets.js';

export function PluginAppAvatar({ avatar, color, className, variant = 'menu' }: Readonly<{
  avatar: BrandIconConfig;
  color?: AppAvatarColor;
  className?: string;
  variant?: SettingsPluginIconProps['variant'];
}>) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (avatar.type === 'custom' && avatar.dataUrl !== failedImage) {
    return <img alt="" draggable={false} src={avatar.dataUrl}
      className={['desktop-icon-avatar-image', `desktop-icon-avatar-size--${variant}`, className].filter(Boolean).join(' ')}
      onError={() => setFailedImage(avatar.dataUrl)} />;
  }
  const preset = APP_AVATAR_PRESETS.find((item) => avatar.type === 'preset' && item.key === avatar.key) ?? APP_AVATAR_PRESETS[0];
  return <IconAvatar Icon={preset.Icon} color={color ?? preset.color} className={className} variant={variant} />;
}
