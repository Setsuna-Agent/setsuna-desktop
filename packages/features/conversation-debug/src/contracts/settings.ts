import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { conversationDebugFeature } from './definition.js';

export const LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG = 'developer_features';

export type ConversationDebugSettings = Readonly<{
  enabled: boolean;
}>;

export type ConversationDebugSettingsPatch = Readonly<{
  enabled?: boolean;
}>;

export type ConversationDebugSettingsState = Readonly<{
  value: ConversationDebugSettings;
  revision: number;
}>;

export type ConversationDebugSettingsUpdate = Readonly<{
  expectedRevision: number;
  patch: ConversationDebugSettingsPatch;
}>;

export const DEFAULT_CONVERSATION_DEBUG_SETTINGS: ConversationDebugSettings = Object.freeze({
  enabled: false,
});

export const conversationDebugSettingsCodec = defineRuntimeCodec<ConversationDebugSettings>((value) => {
  const record = objectRecord(value, 'Conversation debug settings must be an object.');
  if (typeof record.enabled !== 'boolean') {
    throw new Error('Conversation debug enabled must be a boolean.');
  }
  return Object.freeze({ enabled: record.enabled });
});

export const conversationDebugSettingsPatchCodec = defineRuntimeCodec<ConversationDebugSettingsPatch>((value) => {
  const record = objectRecord(value, 'Conversation debug settings patch must be an object.');
  if (!Object.hasOwn(record, 'enabled')) return Object.freeze({});
  if (typeof record.enabled !== 'boolean') {
    throw new Error('Conversation debug enabled patch must be a boolean.');
  }
  return Object.freeze({ enabled: record.enabled });
});

const preferencesDocument = defineFeatureSettingsDocument<
  ConversationDebugSettings,
  ConversationDebugSettings,
  ConversationDebugSettingsPatch,
  undefined
>({
  currentVersion: 1,
  schema: conversationDebugSettingsCodec,
  defaults: () => DEFAULT_CONVERSATION_DEBUG_SETTINGS,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (value, patch) => conversationDebugSettingsCodec.parse({ ...value, ...patch }),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  // Diagnostics are intentionally local to one runtime process and should not follow backups.
  syncPolicy: 'device-local',
});

export const conversationDebugFeatureSettings = defineFeatureSettingsBundle({
  featureId: conversationDebugFeature.id,
  documents: { preferences: preferencesDocument },
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
