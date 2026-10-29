import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { useId, useState } from 'react';
import { BUILTIN_COLLABORATION_ROLES, type CollaborationAgentRole, type CollaborationModelOption } from '../contracts/index.js';
import { CollaborationReasoningSelect } from './CollaborationReasoningSelect.js';
import { CollaborationAvatarPicker } from './CollaborationAvatarPicker.js';

export function CollaborationRoleDialog({
  ui, translate: t, role, creating, models, inheritedModel, saving, onSave, onRemove, onClose,
}: Readonly<{
  ui: SettingsViewUi;
  translate: RendererTranslate;
  role: CollaborationAgentRole;
  creating: boolean;
  models: readonly CollaborationModelOption[];
  inheritedModel: CollaborationAgentRole['model'];
  saving: boolean;
  onSave(role: CollaborationAgentRole): Promise<void>;
  onRemove?(): Promise<void>;
  onClose(): void;
}>) {
  // Keep edits local until the server confirms Save; cancelling never mutates the list.
  const [draft, setDraft] = useState(role);
  const [readingAvatar, setReadingAvatar] = useState(false);
  const busy = saving || readingAvatar;
  const formId = useId();
  const patch = (value: Partial<CollaborationAgentRole>) => setDraft((current) => ({ ...current, ...value }));
  const requestClose = () => { if (!saving) onClose(); };
  const builtin = BUILTIN_COLLABORATION_ROLES.some((name) => name === role.name);
  const description = draft.description ?? (builtin ? t(`feature.collaboration.roles.${role.name}.description`) : '');
  const instructions = draft.instructions ?? (builtin ? t(`feature.collaboration.roles.${role.name}.instructions`) : '');

  return (
    <ui.Dialog
      title={t(creating ? 'feature.collaboration.settings.add' : 'feature.collaboration.settings.edit')}
      closeLabel={t('feature.collaboration.settings.close')}
      onClose={requestClose}
      footer={<div className="collaboration-role-dialog__footer">
        {onRemove ? (
          <ConfirmDialogTrigger
            title={t('feature.collaboration.settings.removeConfirm', { name: role.name })}
            confirmLabel={t('feature.collaboration.settings.remove')}
            cancelLabel={t('feature.collaboration.settings.cancel')}
            danger disabled={saving} onConfirm={onRemove}
          >
            <ui.Button variant="danger" disabled={saving}>{t('feature.collaboration.settings.remove')}</ui.Button>
          </ConfirmDialogTrigger>
        ) : null}
        <div className="collaboration-role-dialog__actions">
          <ui.Button disabled={saving} onClick={requestClose}>{t('feature.collaboration.settings.cancel')}</ui.Button>
          <ui.Button type="submit" form={formId} variant="primary" disabled={busy || !draft.name.trim()} aria-busy={busy}>
            {t('feature.collaboration.settings.save')}
          </ui.Button>
        </div>
      </div>}
    >
      <form id={formId} className="collaboration-role-dialog__form" onSubmit={(event) => {
        event.preventDefault();
        if (busy || !draft.name.trim()) return;
        // Renaming a built-in creates a custom role, so retain its currently visible text.
        void onSave(draft.name.trim() === role.name ? draft : { ...draft, description, instructions });
      }}>
        <div className="collaboration-role-dialog__identity">
          <CollaborationAvatarPicker value={draft.avatar} seed={draft.name || 'default'} disabled={busy} translate={t}
            onChange={(avatar) => patch({ avatar })} onBusyChange={setReadingAvatar} />
          <label className="collaboration-role-dialog__field">
            <span>{t('feature.collaboration.settings.name')}</span>
            <ui.TextField value={draft.name} autoFocus={creating} disabled={busy || role.name === 'default'}
              required maxLength={64} spellCheck={false} onChange={(event) => patch({ name: event.target.value })} />
          </label>
        </div>
        <label className="collaboration-role-dialog__field">
          <span>{t('feature.collaboration.settings.description')}</span>
          <ui.TextField value={description} disabled={saving} maxLength={1000}
            onChange={(event) => patch({ description: event.target.value })} />
        </label>
        <label className="collaboration-role-dialog__field collaboration-role-dialog__field--full">
          <span>{t('feature.collaboration.settings.instructions')}</span>
          <ui.TextArea className="collaboration-role-dialog__instructions" value={instructions}
            disabled={saving} rows={6} maxLength={16000} onChange={(event) => patch({ instructions: event.target.value })} />
        </label>
        <div className="collaboration-role-dialog__field">
          <span>{t('feature.collaboration.settings.roleModel')}</span>
          <ui.ModelPicker aria-label={t('feature.collaboration.settings.roleModel')} models={models} value={draft.model}
            disabled={saving} defaultLabel={t('feature.collaboration.settings.inherit')}
            unavailableLabel={t('feature.collaboration.settings.unavailable')}
            onChange={(model) => patch({ model, reasoningEffort: null })} />
        </div>
        <label className="collaboration-role-dialog__field">
          <span>{t('feature.collaboration.settings.roleEffort')}</span>
          <CollaborationReasoningSelect ui={ui} translate={t} models={models} model={draft.model ?? inheritedModel}
            label={t('feature.collaboration.settings.roleEffort')} value={draft.reasoningEffort} disabled={saving}
            onChange={(reasoningEffort) => patch({ reasoningEffort })} />
        </label>
      </form>
    </ui.Dialog>
  );
}
