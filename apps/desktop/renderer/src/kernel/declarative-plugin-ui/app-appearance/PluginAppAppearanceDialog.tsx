import type { BrandIconConfig } from '@setsuna-desktop/contracts';
import { ToastNotice, Button, Dialog, TextField } from '@setsuna-desktop/renderer-ui';
import { useId, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { PresetAvatar } from '../../../shared/ui/icon-avatars/PresetAvatar.js';
import { PLUGIN_APP_NAME_MAX_LENGTH, type PluginAppAppearance } from './preferences.js';
import { IconAvatarPicker } from '../../../shared/ui/icon-avatars/IconAvatarPicker.js';
import { useIconAvatarDraft } from '../../../shared/ui/icon-avatars/useIconAvatarDraft.js';
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
  const [name, setName] = useState(appearance.name ?? defaultName);
  const [avatarColor, setAvatarColor] = useState(appearance.avatarColor);
  const draft = useIconAvatarDraft(appearance.avatar);
  const { avatar, loading, error, errorRevision, reportError } = draft;
  const reading = loading !== null;

  return (
    <Dialog title={t('pluginUi.editApp')} width={560} onClose={onClose}>
      <form className="plugin-app-appearance" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || reading) return;
        const next = { ...(name.trim() !== defaultName ? { name: name.trim() } : {}), avatar,
          ...(avatarColor ? { avatarColor } : {}) };
        if (onSave(next)) onClose();
        else reportError(t('pluginUi.appearanceSaveFailed'));
      }}>
        <div className="plugin-app-appearance__identity">
          <PresetAvatar avatar={avatar ?? appearance.avatar} color={avatarColor} variant="list" />
          <div className="plugin-app-appearance__name">
            <label htmlFor={nameId}>{t('pluginUi.appName')}</label>
            <TextField id={nameId} autoFocus value={name} maxLength={PLUGIN_APP_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <IconAvatarPicker draft={draft} color={avatarColor} onColorChange={setAvatarColor}
          websiteUrl={websiteUrl} label={t('pluginUi.appAvatar')} />
        {error ? <ToastNotice key={errorRevision} message={error} /> : null}
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
