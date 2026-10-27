import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { iconColorCssValue, type IconColor } from './icon-colors.js';
import '../styles/icon-avatar.css';

/** Shared color-and-glyph surface for Plugins and sidebar app avatars. */
export function IconAvatar({ Icon, color, className, variant = 'menu' }: Readonly<{
  Icon: LucideIcon;
  color: IconColor;
  className?: string;
  variant?: SettingsPluginIconProps['variant'];
}>) {
  return (
    <span
      className={['desktop-icon-avatar', `desktop-icon-avatar-size--${variant}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{ '--desktop-icon-avatar-color': iconColorCssValue(color) } as CSSProperties}
    >
      <Icon strokeWidth={1.9} />
    </span>
  );
}
