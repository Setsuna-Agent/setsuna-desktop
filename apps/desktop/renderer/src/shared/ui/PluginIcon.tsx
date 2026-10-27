import { isRuntimePluginIconDataUrl } from '@setsuna-desktop/contracts';
import type { SettingsPluginIconProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useState } from 'react';
import { IconAvatar } from './IconAvatar.js';
import { resolvePluginIconPreset } from './plugin-icon-presets.js';

/** Repository artwork stays inert; missing or failed images use a color-and-glyph avatar. */
export function PluginIcon({
  className,
  name,
  iconImage,
  pluginId,
  variant = 'card',
}: Omit<SettingsPluginIconProps, 'appContributionId'>) {
  const [failedImages, setFailedImages] = useState<readonly string[]>([]);
  const light = isRuntimePluginIconDataUrl(iconImage?.light) && !failedImages.includes(iconImage.light) ? iconImage.light : undefined;
  const dark = isRuntimePluginIconDataUrl(iconImage?.dark) && !failedImages.includes(iconImage.dark) ? iconImage.dark : undefined;
  const imageSource = light ?? dark;
  const classes = ['desktop-plugin-icon', className].filter(Boolean).join(' ');

  if (!imageSource) {
    const preset = resolvePluginIconPreset(name, pluginId);
    return <IconAvatar Icon={preset.Icon} color={preset.color} className={classes} variant={variant} />;
  }

  return (
    <span
      className={`${classes} desktop-icon-avatar-size--${variant}`}
      aria-hidden="true"
    >
      <img
        alt=""
        className={`desktop-plugin-icon__artwork${light && dark ? ' is-light-variant' : ''}`}
        draggable={false}
        src={imageSource}
        onError={() => setFailedImages((failed) => [...failed, imageSource])}
      />
      {light && dark ? (
        <img
          alt=""
          className="desktop-plugin-icon__artwork is-dark-variant"
          draggable={false}
          src={dark}
          onError={() => setFailedImages((failed) => [...failed, dark])}
        />
      ) : null}
    </span>
  );
}
