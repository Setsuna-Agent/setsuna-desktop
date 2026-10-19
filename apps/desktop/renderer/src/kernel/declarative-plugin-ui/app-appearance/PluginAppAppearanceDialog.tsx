import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { Button, Dialog, TextField, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Download, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { brandIconFileAccept } from '../../../shared/branding/brandIconUpload.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { PluginAppAvatar } from './PluginAppAvatar.js';
import { IconColorPicker } from '../../../shared/ui/IconColorPicker.js';
import { PLUGIN_APP_NAME_MAX_LENGTH, type PluginAppAppearance } from './preferences.js';
import { APP_AVATAR_PRESETS } from './app-avatar-presets.js';
import { usePluginAppAvatarDraft } from './usePluginAppAvatarDraft.js';
import './app-appearance.css';

export function PluginAppAppearanceDialog({ appearance, defaultName, pluginName, websiteUrl, onClose, onSave, onViewPlugin }: Readonly<{
  appearance: PluginAppAppearance & { avatar: BrandIconConfig };
  defaultName: string;
  pluginName: string;
  websiteUrl?: string;
  onClose(): void;
  onSave(appearance: PluginAppAppearance): boolean;
  onViewPlugin(): void;
}>) {
  const { t } = useI18n();
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(appearance.name ?? defaultName);
  const [avatarColor, setAvatarColor] = useState(appearance.avatarColor);
  const { avatar, setAvatar, customAvatar, loading, error, setError, upload, fetchWebsiteIcon } = usePluginAppAvatarDraft(appearance.avatar);
  const reading = loading !== null;

  return (
    <Dialog title={t('pluginUi.editApp')} width={560} onClose={onClose}>
      <form className="plugin-app-appearance" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || reading) return;
        const next = { ...(name.trim() !== defaultName ? { name: name.trim() } : {}), avatar,
          ...(avatarColor ? { avatarColor } : {}) };
        if (onSave(next)) onClose();
        else setError(t('pluginUi.appearanceSaveFailed'));
      }}>
        <div className="plugin-app-appearance__identity">
          <PluginAppAvatar avatar={avatar} color={avatarColor} variant="list" />
          <div className="plugin-app-appearance__name">
            <label htmlFor={nameId}>{t('pluginUi.appName')}</label>
            <TextField id={nameId} autoFocus value={name} maxLength={PLUGIN_APP_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <fieldset className="plugin-app-appearance__avatars" disabled={reading}>
          <legend>
            <span>{t('pluginUi.appAvatar')}</span>
            <IconColorPicker value={avatarColor} disabled={reading} onChange={setAvatarColor}
              label={t('pluginUi.avatarColors')} colorLabel={(color) => t('pluginUi.avatarColor', { color })} />
          </legend>
          <div className="plugin-app-appearance__presets">
            {APP_AVATAR_PRESETS.map((preset, index) => (
              <Tooltip key={preset.key} title={t('pluginUi.avatarPreset', { index: index + 1 })}>
                <Button type="button" variant="ghost" className="plugin-app-appearance__choice"
                  aria-label={t('pluginUi.avatarPreset', { index: index + 1 })}
                  aria-pressed={avatar.type === 'preset' && avatar.key === preset.key}
                  onClick={() => setAvatar({ type: 'preset', key: preset.key })}>
                  <PluginAppAvatar avatar={{ type: 'preset', key: preset.key }} color={avatarColor} />
                </Button>
              </Tooltip>
            ))}
            {customAvatar ? (
              <Tooltip title={t('pluginUi.uploadedAvatar')}>
                <Button type="button" variant="ghost" className="plugin-app-appearance__choice"
                  aria-label={t('pluginUi.uploadedAvatar')} aria-pressed={avatar.type === 'custom'}
                  onClick={() => setAvatar(customAvatar)}>
                  <PluginAppAvatar avatar={customAvatar} />
                </Button>
              </Tooltip>
            ) : null}
          </div>
          <div className="plugin-app-appearance__image-actions">
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
        {error ? <div className="plugin-app-appearance__error" role="alert">{error}</div> : null}
        <div className="sd-dialog-form-actions">
          <button type="button" className="plugin-app-appearance__plugin-link" onClick={() => {
            onClose();
            onViewPlugin();
          }}>{t('pluginUi.linkedPlugin', { name: pluginName })}</button>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || reading}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
