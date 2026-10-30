import { Button, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Download, Upload } from 'lucide-react';
import { useRef } from 'react';
import { brandIconFileAccept } from '../../branding/brandIconUpload.js';
import { useI18n } from '../../i18n/I18nProvider.js';
import { IconColorPicker } from '../IconColorPicker.js';
import type { IconColor } from '../icon-colors.js';
import { PresetAvatar } from './PresetAvatar.js';
import { ICON_AVATAR_PRESETS } from './presets.js';
import type { useIconAvatarDraft } from './useIconAvatarDraft.js';
import './picker.css';

export function IconAvatarPicker({ draft, color: avatarColor, onColorChange: setAvatarColor, websiteUrl, label }: Readonly<{
  draft: ReturnType<typeof useIconAvatarDraft>;
  color?: IconColor;
  onColorChange(color: IconColor): void;
  websiteUrl?: string;
  label: string;
}>) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const { avatar, setAvatar, customAvatar, loading, upload, fetchWebsiteIcon } = draft;
  const reading = loading !== null;
  return (
    <fieldset className="icon-avatar-picker__avatars" disabled={reading}>
      <legend>
        <span>{label}</span>
        <IconColorPicker value={avatarColor} disabled={reading} onChange={setAvatarColor}
          label={t('pluginUi.avatarColors')} colorLabel={(color) => t('pluginUi.avatarColor', { color })} />
      </legend>
      <div className="icon-avatar-picker__presets">
        {ICON_AVATAR_PRESETS.map((preset, index) => (
          <Tooltip key={preset.key} title={t('pluginUi.avatarPreset', { index: index + 1 })}>
            <Button type="button" variant="ghost" className="icon-avatar-picker__choice"
              aria-label={t('pluginUi.avatarPreset', { index: index + 1 })}
              aria-pressed={avatar?.type === 'preset' && avatar.key === preset.key}
              onClick={() => setAvatar({ type: 'preset', key: preset.key })}>
              <PresetAvatar avatar={{ type: 'preset', key: preset.key }} color={avatarColor} />
            </Button>
          </Tooltip>
        ))}
        {customAvatar ? (
          <Tooltip title={t('pluginUi.uploadedAvatar')}>
            <Button type="button" variant="ghost" className="icon-avatar-picker__choice"
              aria-label={t('pluginUi.uploadedAvatar')} aria-pressed={avatar?.type === 'custom'}
              onClick={() => setAvatar(customAvatar)}>
              <PresetAvatar avatar={customAvatar} />
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
