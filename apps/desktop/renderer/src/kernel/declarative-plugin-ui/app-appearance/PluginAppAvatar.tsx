import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useState, type CSSProperties } from 'react';
import { APP_AVATAR_PRESETS } from './app-avatar-presets.js';
import './app-appearance.css';

export function PluginAppAvatar({ avatar, className, variant = 'menu' }: Readonly<{
  avatar: BrandIconConfig;
  className?: string;
  variant?: SettingsPluginIconProps['variant'];
}>) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (avatar.type === 'custom' && avatar.dataUrl !== failedImage) {
    return <img alt="" draggable={false} src={avatar.dataUrl}
      className={['plugin-app-avatar-image', `plugin-app-avatar-size--${variant}`, className].filter(Boolean).join(' ')}
      onError={() => setFailedImage(avatar.dataUrl)} />;
  }
  const preset = APP_AVATAR_PRESETS.find((item) => avatar.type === 'preset' && item.key === avatar.key) ?? APP_AVATAR_PRESETS[0];
  const Icon = preset.Icon;
  return (
    <span className={['plugin-app-avatar', `plugin-app-avatar-size--${variant}`, className].filter(Boolean).join(' ')} aria-hidden="true"
      style={{ '--plugin-app-avatar-color': preset.color } as CSSProperties}>
      <Icon strokeWidth={1.9} />
    </span>
  );
}
