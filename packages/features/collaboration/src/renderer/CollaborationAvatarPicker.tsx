import { BRAND_ICON_MIME_TYPES } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, IconColorPicker, Popover, ToastNotice, Tooltip } from '@setsuna-desktop/renderer-ui';
import { RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { COLLABORATION_AVATAR_KEYS, type CollaborationAgentAvatar } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';
import { agentAvatarKey } from './agent-avatar-presets.js';
import { useAgentAvatarUpload } from './useAgentAvatarUpload.js';

export function CollaborationAvatarPicker({ value, seed, disabled, translate: t, onChange, onBusyChange }: Readonly<{
  value?: CollaborationAgentAvatar;
  seed: string;
  disabled: boolean;
  translate: RendererTranslate;
  onChange(avatar: CollaborationAgentAvatar | undefined): void;
  onBusyChange(busy: boolean): void;
}>) {
  const [open, setOpen] = useState(false);
  const [customAvatar, setCustomAvatar] = useState(value?.type === 'custom' ? value : undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload, error } = useAgentAvatarUpload(t, (avatar) => {
    if (avatar.type === 'custom') setCustomAvatar(avatar);
    onChange(avatar);
  }, onBusyChange);
  const color = value?.type === 'preset' ? value.color : undefined;
  const selectedKey = value?.type === 'preset' ? value.key : !value ? agentAvatarKey(seed) : undefined;
  const avatar = (value?: CollaborationAgentAvatar, size = 20) => <AgentAvatar size={size}
    identity={{ avatar: value, avatarSeed: seed, displayName: seed }} />;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen} placement="bottomLeft" className="collaboration-avatar-picker"
        contentLabel={t('feature.collaboration.avatar.change')} content={<>
          <div className="collaboration-avatar-picker__toolbar">
            <IconColorPicker value={color} disabled={disabled || value?.type === 'custom'}
              label={t('feature.collaboration.avatar.colors')} textColorLabel={t('feature.collaboration.avatar.textColor')}
              colorLabel={(color) => t('feature.collaboration.avatar.color', { color })}
              onChange={(color) => onChange({ type: 'preset', key: selectedKey ?? agentAvatarKey(seed), color })} />
            <IconButton label={t('feature.collaboration.avatar.reset')} disabled={disabled || !value}
              onClick={() => { onChange(undefined); setOpen(false); }}><RotateCcw size={14} /></IconButton>
          </div>
          <div className="collaboration-avatar-picker__grid" role="group" aria-label={t('feature.collaboration.avatar.presets')}>
            {COLLABORATION_AVATAR_KEYS.map((key, index) => (
              <Tooltip key={key} title={t('feature.collaboration.avatar.preset', { index: index + 1 })}>
                <Button variant="ghost" className="collaboration-avatar-picker__choice" disabled={disabled}
                  aria-label={t('feature.collaboration.avatar.preset', { index: index + 1 })} aria-pressed={selectedKey === key}
                  onClick={() => onChange({ type: 'preset', key, ...(color ? { color } : {}) })}>
                  {avatar({ type: 'preset', key, ...(color ? { color } : {}) })}
                </Button>
              </Tooltip>
            ))}
            {customAvatar ? <Tooltip title={t('feature.collaboration.avatar.uploaded')}>
              <Button variant="ghost" className="collaboration-avatar-picker__choice" disabled={disabled}
                aria-label={t('feature.collaboration.avatar.uploaded')} aria-pressed={value?.type === 'custom'}
                onClick={() => onChange(customAvatar)}>{avatar(customAvatar)}</Button>
            </Tooltip> : null}
          </div>
          <Button size="small" disabled={disabled} className="collaboration-avatar-picker__upload"
            onClick={() => fileInput.current?.click()}><Upload size={14} />{t('feature.collaboration.avatar.upload')}</Button>
        </>}>
        <IconButton className="collaboration-role-dialog__avatar" label={t('feature.collaboration.avatar.change')} disabled={disabled}>
          {avatar(value, 24)}
        </IconButton>
      </Popover>
      <input ref={fileInput} type="file" hidden accept={BRAND_ICON_MIME_TYPES.join(',')} disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }} />
      {error ? <ToastNotice key={error.id} tone="error" message={error.message} /> : null}
    </>
  );
}
