import type { AssistantAvatarFieldProps, AssistantAvatarProps, AssistantModelPickerProps, AssistantsHostUi } from '@setsuna-desktop/feature-assistants/renderer';
import { IconButton, normalizeIconColor, Popover, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconAvatarPicker } from '../../shared/ui/icon-avatars/IconAvatarPicker.js';
import { PresetAvatar } from '../../shared/ui/icon-avatars/PresetAvatar.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import { useIconAvatarDraft } from '../../shared/ui/icon-avatars/useIconAvatarDraft.js';
import { FeatureModelPicker } from '../feature-ui/FeatureModelPicker.js';
import { ASSISTANT_AVATAR_PRESETS, DEFAULT_ASSISTANT_AVATAR } from './assistant-avatar-presets.js';

/** Unconfigured assistants use the robot identity across the sidebar, editor and conversation. */
export function AssistantAvatar({ assistant, size = 'menu', className }: AssistantAvatarProps) {
  return <PresetAvatar avatar={assistant.avatar ?? DEFAULT_ASSISTANT_AVATAR} presets={ASSISTANT_AVATAR_PRESETS} color={normalizeIconColor(assistant.avatarColor) ?? 'text'}
    variant={size} className={className} />;
}

function AssistantAvatarField({ value, seed, label, disabled, onBusyChange, onChange }: AssistantAvatarFieldProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Keep uploads alive when the popover content unmounts on dismissal.
  const draft = useIconAvatarDraft(value.avatar);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // The shared picker keeps uploads and preset choices in its own draft; mirror them into the form.
  useEffect(() => {
    const { value, onChange } = latest.current;
    if (draft.avatar !== value.avatar) onChange({ ...value, avatar: draft.avatar });
  }, [draft.avatar]);
  useEffect(() => { onBusyChange(draft.loading !== null); }, [draft.loading, onBusyChange]);
  return <>
    <Popover open={open && !disabled} onOpenChange={setOpen} placement="bottomLeft" className="assistant-avatar-picker" contentLabel={label} content={
      <IconAvatarPicker compact draft={draft} disabled={disabled} label={label} color={normalizeIconColor(value.avatarColor)}
        presets={ASSISTANT_AVATAR_PRESETS} presetLabel={(key) => t(`feature.assistants.avatarPreset.${key}`)}
        onReset={() => { draft.setAvatar(undefined); onChange({}); setOpen(false); }}
        onColorChange={(avatarColor) => onChange({ ...value, avatarColor })} />
    }>
      <IconButton label={label} disabled={disabled || draft.loading !== null}>
        <AssistantAvatar assistant={{ ...value, id: seed ?? '' }} className="desktop-icon-avatar--glyph" />
      </IconButton>
    </Popover>
    {draft.error ? <ToastNotice key={draft.errorRevision} message={draft.error} /> : null}
  </>;
}

function AssistantModelPicker({ translate, ...props }: AssistantModelPickerProps) {
  return <FeatureModelPicker {...props} label={translate('feature.assistants.model')} defaultLabel={translate('feature.assistants.defaultModel')} />;
}

export const assistantsHostUi: AssistantsHostUi = Object.freeze({
  Avatar: AssistantAvatar,
  AvatarField: AssistantAvatarField,
  ModelPicker: AssistantModelPicker,
  ProjectIcon,
});
