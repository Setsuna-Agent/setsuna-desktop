import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { CollaborationAgentRole } from '../contracts/index.js';
import type { CollaborationClient } from './client.js';
import { CollaborationReasoningSelect } from './CollaborationReasoningSelect.js';
import { CollaborationRoleDialog } from './CollaborationRoleDialog.js';
import { useCollaborationSettings } from './useCollaborationSettings.js';
import { AgentAvatar } from './AgentAvatar.js';
import './collaboration-settings.css';

export function CollaborationSettingsView({ client, translate: t, ui }: Readonly<{
  client: Pick<CollaborationClient, 'readSettings' | 'updateSettings'>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { state, saving, error, save } = useCollaborationSettings(client);
  const [editing, setEditing] = useState<{ role: CollaborationAgentRole; originalName: string | null } | null>(null);
  const settings = state?.settings;
  const models = state?.availableModels ?? [];
  const saveRole = async (role: CollaborationAgentRole) => {
    if (!settings || !editing) return;
    const roles = editing.originalName === null ? [...settings.roles, role]
      : settings.roles.map((current) => current.name === editing.originalName ? role : current);
    if (await save({ ...settings, roles })) setEditing(null);
  };
  const removeRole = async () => {
    if (!settings || !editing?.originalName || editing.originalName === 'default') return;
    if (await save({ ...settings, roles: settings.roles.filter((role) => role.name !== editing.originalName) })) setEditing(null);
  };

  return (
    <ui.Section featureId="collaboration">
      <ui.Group title={t('feature.collaboration.settings.title')}>
        {settings ? <>
          <ui.Row label={t('feature.collaboration.settings.model')}>
            <ui.ModelPicker
              aria-label={t('feature.collaboration.settings.model')}
              models={models}
              value={settings.model}
              disabled={saving}
              defaultLabel={t('feature.collaboration.settings.inherit')}
              unavailableLabel={t('feature.collaboration.settings.unavailable')}
              onChange={(model) => { void save({ ...settings, model, reasoningEffort: null }); }}
            />
          </ui.Row>
          <ui.Row label={t('feature.collaboration.settings.effort')}>
            <CollaborationReasoningSelect ui={ui} translate={t} models={models} model={settings.model}
              label={t('feature.collaboration.settings.effort')} value={settings.reasoningEffort} disabled={saving}
              onChange={(reasoningEffort) => { void save({ ...settings, reasoningEffort }); }} />
          </ui.Row>
        </> : null}
      </ui.Group>
      <ui.Group title={<div className="collaboration-settings__roles-heading">
        <span>{t('feature.collaboration.settings.role')}</span>
        <ui.Button variant="ghost" icon={<Plus size={14} />} disabled={!settings || saving} onClick={() => setEditing({
          originalName: null, role: { name: '', description: '', instructions: '', model: null, reasoningEffort: null },
        })}>{t('feature.collaboration.settings.add')}</ui.Button>
      </div>}>
        {settings?.roles.map((role) => (
          <ui.NavigationRow key={role.name} label={role.name} disabled={saving}
            icon={<AgentAvatar identity={{ displayName: role.name, avatarSeed: role.name, avatar: role.avatar }} size={18} />}
            onClick={() => setEditing({ role, originalName: role.name })} />
        ))}
      </ui.Group>
      {editing && settings ? (
        <CollaborationRoleDialog key={editing.originalName ?? 'create'} ui={ui} translate={t}
          role={editing.role} creating={editing.originalName === null} models={models} inheritedModel={settings.model}
          saving={saving} onSave={saveRole} onRemove={editing.originalName && editing.originalName !== 'default' ? removeRole : undefined}
          onClose={() => setEditing(null)} />
      ) : null}
      {error ? <ui.Toast key={error.id} tone="error" message={error.message} /> : null}
    </ui.Section>
  );
}
