import { Button, IconButton, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { brandIconFileAccept } from '../../branding/brandIconUpload.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { IconColorPicker } from '../IconColorPicker.js';
import { iconColorCssValue, type IconColor } from '../icon-colors.js';
import { PresetAvatar } from './PresetAvatar.js';
import { ICON_AVATAR_PRESETS, type IconAvatarPreset } from './presets.js';
import type { useIconAvatarDraft } from './useIconAvatarDraft.js';
import './picker.css';

export function IconAvatarPicker({ draft, color: avatarColor, onColorChange: setAvatarColor, websiteUrl, label, disabled,
  presets = ICON_AVATAR_PRESETS, presetLabel, compact = false, onReset }: Readonly<{
  draft: ReturnType<typeof useIconAvatarDraft>;
  color?: IconColor;
  onColorChange(color: IconColor): void;
  websiteUrl?: string;
  label: string;
  disabled?: boolean;
  presets?: readonly IconAvatarPreset[];
  presetLabel?(key: string): string;
  compact?: boolean;
  onReset?(): void;
}>) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const { avatar, setAvatar, customAvatar, loading, upload, fetchWebsiteIcon } = draft;
  const reading = loading !== null;
  const color = avatarColor ?? (compact ? 'text' : undefined);
  const selectedKey = avatar?.type === 'preset' ? avatar.key : !avatar && compact ? presets[0]?.key : undefined;
  const colors = <IconColorPicker value={color} disabled={reading || disabled} onChange={setAvatarColor}
    label={t('pluginUi.avatarColors')} colorLabel={(color) => t('pluginUi.avatarColor', { color })} />;
  return (
    <fieldset className={['icon-avatar-picker__avatars', compact && 'icon-avatar-picker--compact'].filter(Boolean).join(' ')}
      aria-label={compact ? label : undefined} disabled={reading || disabled}
      style={compact ? { '--icon-avatar-picker-color': iconColorCssValue(color ?? 'text') } as CSSProperties : undefined}>
      {compact ? <div className="icon-avatar-picker__toolbar">
        {colors}
        {onReset ? <IconButton label={t('pluginUi.resetPluginIcon')} disabled={reading || disabled || (!avatar && !avatarColor)}
          onClick={onReset}><RotateCcw size={14} /></IconButton> : null}
      </div> : <legend>
        <span>{label}</span>
        {colors}
      </legend>}
      <div className="icon-avatar-picker__presets">
        {presets.map((preset, index) => {
          const title = presetLabel?.(preset.key) ?? t('pluginUi.avatarPreset', { index: index + 1 });
          return <Tooltip key={preset.key} title={title}>
            <Button type="button" variant="ghost" className="icon-avatar-picker__choice"
              aria-label={title}
              aria-pressed={selectedKey === preset.key}
              onClick={() => setAvatar({ type: 'preset', key: preset.key })}>
              <PresetAvatar avatar={{ type: 'preset', key: preset.key }} color={color} presets={presets}
                className={compact ? 'desktop-icon-avatar--glyph' : undefined} />
            </Button>
          </Tooltip>;
        })}
        {customAvatar ? (
          <Tooltip title={t('pluginUi.uploadedAvatar')}>
            <Button type="button" variant="ghost" className="icon-avatar-picker__choice"
              aria-label={t('pluginUi.uploadedAvatar')} aria-pressed={avatar?.type === 'custom'}
              onClick={() => setAvatar(customAvatar)}>
              <PresetAvatar avatar={customAvatar} presets={presets} />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <div className="icon-avatar-picker__image-actions">
        <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
          <Upload size={14} />{loading === 'upload' ? t('settings.brand.reading') : t('pluginUi.uploadAvatar')}
        </Button>
        {websiteUrl ? (
          <Button type="button" variant="secondary" onClick={() => { void fetchWebsiteIcon(websiteUrl); }}>
            <Download size={14} />{loading === 'website' ? t('pluginUi.fetchingAvatar') : t('pluginUi.fetchAvatar')}
          </Button>
        ) : null}
      </div>
      <input ref={fileInput} type="file" hidden accept={brandIconFileAccept} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void upload(file);
      }} />
    </fieldset>
  );
}
