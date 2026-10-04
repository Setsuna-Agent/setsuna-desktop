import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { Button, Dialog, TextField, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { brandIconFileAccept, brandIconMaxSizeLabel, readBrandIconFile } from '../../../shared/branding/brandIconUpload.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { PluginAppAvatar } from './PluginAppAvatar.js';
import { PLUGIN_APP_NAME_MAX_LENGTH, type PluginAppAppearance } from './preferences.js';
import { APP_AVATAR_PRESETS } from './app-avatar-presets.js';
import './app-appearance.css';

export function PluginAppAppearanceDialog({ appearance, defaultName, pluginName, onClose, onSave, onViewPlugin }: Readonly<{
  appearance: PluginAppAppearance & { avatar: BrandIconConfig };
  defaultName: string;
  pluginName: string;
  onClose(): void;
  onSave(appearance: PluginAppAppearance): boolean;
  onViewPlugin(): void;
}>) {
  const { t } = useI18n();
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [name, setName] = useState(appearance.name ?? defaultName);
  const [avatar, setAvatar] = useState(appearance.avatar);
  const [customAvatar, setCustomAvatar] = useState<Extract<BrandIconConfig, { type: 'custom' }> | undefined>(
    appearance.avatar.type === 'custom' ? appearance.avatar : undefined,
  );
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const upload = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      const image = await readBrandIconFile(file, {
        emptyFile: t('settings.brand.emptyFile'),
        invalidContent: t('settings.brand.invalidContent'),
        invalidType: t('settings.brand.invalidType'),
        readError: t('settings.brand.readError'),
        tooLarge: t('settings.brand.tooLarge', { size: brandIconMaxSizeLabel }),
      });
      if (!mounted.current) return;
      setCustomAvatar(image);
      setAvatar(image);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t('settings.brand.readError'));
    } finally {
      if (mounted.current) setReading(false);
    }
  };

  return (
    <Dialog title={t('pluginUi.editApp')} width={560} onClose={onClose}>
      <form className="plugin-app-appearance" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || reading) return;
        const next = { ...(name.trim() !== defaultName ? { name: name.trim() } : {}), avatar };
        if (onSave(next)) onClose();
        else setError(t('pluginUi.appearanceSaveFailed'));
      }}>
        <div className="plugin-app-appearance__identity">
          <PluginAppAvatar avatar={avatar} variant="list" />
          <div className="plugin-app-appearance__name">
            <label htmlFor={nameId}>{t('pluginUi.appName')}</label>
            <TextField id={nameId} autoFocus value={name} maxLength={PLUGIN_APP_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <fieldset className="plugin-app-appearance__avatars" disabled={reading}>
          <legend>{t('pluginUi.appAvatar')}</legend>
          <div className="plugin-app-appearance__presets">
            {APP_AVATAR_PRESETS.map((preset, index) => (
              <Tooltip key={preset.key} title={t('pluginUi.avatarPreset', { index: index + 1 })}>
                <Button type="button" variant="ghost" className="plugin-app-appearance__choice"
                  aria-label={t('pluginUi.avatarPreset', { index: index + 1 })}
                  aria-pressed={avatar.type === 'preset' && avatar.key === preset.key}
                  onClick={() => setAvatar({ type: 'preset', key: preset.key })}>
                  <PluginAppAvatar avatar={{ type: 'preset', key: preset.key }} />
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
          <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload size={14} />{reading ? t('settings.brand.reading') : t('pluginUi.uploadAvatar')}
          </Button>
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
