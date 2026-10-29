import type { RuntimeConfiguredModelReference, RuntimeThreadModelBinding } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureSettingsBundle, defineFeatureSettingsDocument } from '@setsuna-desktop/feature-core/settings';
import { collaborationFeature } from './definition.js';
import { BUILTIN_COLLABORATION_ROLES, LEGACY_COLLABORATION_ROLE_TEXT } from './agent-role-text.js';
import { collaborationAgentAvatarCodec, type CollaborationAgentAvatar } from './avatar.js';

export type CollaborationAgentRole = Readonly<{
  name: string;
  avatar?: CollaborationAgentAvatar;
  /** null uses localized built-in text; strings are user-authored overrides. */
  description: string | null;
  instructions: string | null;
  model: RuntimeConfiguredModelReference | null;
  reasoningEffort: string | null;
}>;

export type CollaborationAgentSettings = Readonly<{
  model: RuntimeConfiguredModelReference | null;
  reasoningEffort: string | null;
  roles: readonly CollaborationAgentRole[];
}>;

/** Captured at dispatch so resuming an existing agent keeps its original configuration. */
export type CollaborationAgentConfiguration = Readonly<{
  role: string;
  /** Role description at dispatch; older tasks may not have captured it. */
  description?: string;
  instructions: string;
  modelBinding?: RuntimeThreadModelBinding;
  thinking?: boolean;
  reasoningEffort?: string;
}>;

export type CollaborationModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
  reasoningEfforts: readonly string[];
}>;

export type CollaborationSettingsState = Readonly<{
  settings: CollaborationAgentSettings;
  revision: number;
  availableModels: readonly CollaborationModelOption[];
}>;

export const collaborationModelSelectionCodec = defineRuntimeCodec<RuntimeConfiguredModelReference | null>((value) => {
  if (value === undefined || value === null) return null;
  const record = agentRecord(value);
  return { providerId: agentText(record.providerId, 256), modelId: agentText(record.modelId, 256) };
});

export function agentReasoningEffort(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : agentText(value, 64);
}

export const collaborationAgentSettingsCodec = defineRuntimeCodec<CollaborationAgentSettings>((value) => {
  const record = agentRecord(value);
  if (!Array.isArray(record.roles)) throw new Error('Agent roles must be an array.');
  const names = new Set<string>();
  const roles = record.roles.map((value) => {
    const role = agentRecord(value);
    const name = agentText(role.name, 64);
    if (!/^[a-z][a-z0-9_-]*$/u.test(name) || names.has(name)) throw new Error('Agent role names must be unique identifiers.');
    names.add(name);
    return Object.freeze({ name,
      ...(role.avatar != null ? { avatar: collaborationAgentAvatarCodec.parse(role.avatar) } : {}),
      description: role.description === null ? null : agentText(role.description, 1000, true),
      instructions: role.instructions === null ? null : agentText(role.instructions, 16000, true),
      model: collaborationModelSelectionCodec.parse(role.model),
      reasoningEffort: agentReasoningEffort(role.reasoningEffort),
    });
  });
  if (!names.has('default')) throw new Error('The default agent role is required.');
  roles.sort((left, right) => left.name === 'default' ? -1 : right.name === 'default' ? 1 : 0);
  return Object.freeze({ model: collaborationModelSelectionCodec.parse(record.model),
    reasoningEffort: agentReasoningEffort(record.reasoningEffort), roles: Object.freeze(roles) });
});

export const collaborationAgentConfigurationCodec = defineRuntimeCodec<CollaborationAgentConfiguration>((value) => {
  const record = agentRecord(value);
  const binding = record.modelBinding === undefined ? undefined : agentRecord(record.modelBinding);
  if (record.thinking !== undefined && typeof record.thinking !== 'boolean') throw new Error('Invalid agent thinking setting.');
  return { role: agentText(record.role, 64), instructions: agentText(record.instructions, 16000, true),
    ...(record.description !== undefined ? { description: agentText(record.description, 1000, true) } : {}),
    ...(binding ? { modelBinding: { providerId: agentText(binding.providerId, 256), modelId: agentText(binding.modelId, 256), modelCode: agentText(binding.modelCode, 256) } } : {}),
    ...(record.thinking !== undefined ? { thinking: record.thinking as boolean } : {}),
    ...(record.reasoningEffort !== undefined ? { reasoningEffort: agentText(record.reasoningEffort, 64) } : {}),
  };
});

export function defaultCollaborationAgentSettings(): CollaborationAgentSettings {
  return { model: null, reasoningEffort: null, roles: BUILTIN_COLLABORATION_ROLES.map((name) => ({
    name, description: null, instructions: null, model: null, reasoningEffort: null,
  })) };
}

function migrateBuiltinRoleText(value: unknown): CollaborationAgentSettings {
  const settings = collaborationAgentSettingsCodec.parse(value);
  return { ...settings, roles: settings.roles.map((role) => {
    const name = BUILTIN_COLLABORATION_ROLES.find((name) => name === role.name);
    if (!name) return role;
    const builtin = LEGACY_COLLABORATION_ROLE_TEXT[name];
    return { ...role,
      description: role.description === builtin.description ? null : role.description,
      instructions: role.instructions === builtin.instructions ? null : role.instructions,
    };
  }) };
}

const agentSettingsDocument = defineFeatureSettingsDocument<CollaborationAgentSettings, CollaborationAgentSettings, CollaborationAgentSettings, undefined>({
  currentVersion: 2, schema: collaborationAgentSettingsCodec, defaults: defaultCollaborationAgentSettings,
  migrations: Object.freeze({ 1: migrateBuiltinRoleText }), publicProjection: (value) => value,
  applyPatch: (_value, patch) => collaborationAgentSettingsCodec.parse(patch),
  secretNames: [], normalizeSecretPatch: () => Object.freeze({}), syncPolicy: 'portable',
});

export const collaborationSettings = defineFeatureSettingsBundle({
  featureId: collaborationFeature.id, documents: { agents: agentSettingsDocument },
});

export function agentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent configuration must be an object.');
  return value as Record<string, unknown>;
}

export function agentText(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error('Invalid agent configuration text.');
  return value.trim();
}
