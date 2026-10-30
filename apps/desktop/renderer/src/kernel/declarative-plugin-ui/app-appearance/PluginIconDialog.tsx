import { Button, Dialog, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { usePluginIconAppearance } from '../../../shared/preferences/usePluginIconAppearance.js';
import { IconAvatarPicker } from '../../../shared/ui/icon-avatars/IconAvatarPicker.js';
import { PresetAvatar } from '../../../shared/ui/icon-avatars/PresetAvatar.js';
import { useIconAvatarDraft } from '../../../shared/ui/icon-avatars/useIconAvatarDraft.js';
import type { PluginIconFallback } from '../../../shared/ui/PluginIcon.js';

export default function PluginIconDialog({ pluginId, renderDefault, onClose }: Readonly<{
  pluginId: string;
  renderDefault: PluginIconFallback;
  onClose(): void;
}>) {
  const { t } = useI18n();
  const { appearance, save } = usePluginIconAppearance(pluginId);
  const draft = useIconAvatarDraft(appearance.avatar);
  const [avatarColor, setAvatarColor] = useState(appearance.avatarColor);
  const reading = draft.loading !== null;
  return <Dialog title={t('pluginUi.editPluginIcon')} width={560} onClose={onClose}>
    <form className="plugin-icon-dialog" onSubmit={(event) => {
      event.preventDefault();
      if (reading) return;
      if (save({ avatar: draft.avatar, avatarColor })) onClose();
      else draft.reportError(t('pluginUi.appearanceSaveFailed'));
    }}>
      <div>{draft.avatar
        ? <PresetAvatar avatar={draft.avatar} color={avatarColor} variant="list" />
        : renderDefault(avatarColor)}</div>
      <IconAvatarPicker draft={draft} color={avatarColor} onColorChange={setAvatarColor} label={t('pluginUi.pluginIcon')} />
      {draft.error ? <ToastNotice key={draft.errorRevision} message={draft.error} /> : null}
      <div className="sd-dialog-form-actions">
        <Button type="button" variant="ghost" className="plugin-icon-dialog__reset" disabled={reading}
          onClick={() => { draft.setAvatar(undefined); setAvatarColor(undefined); }}>{t('pluginUi.resetPluginIcon')}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={reading}>{t('common.save')}</Button>
      </div>
    </form>
  </Dialog>;
}
