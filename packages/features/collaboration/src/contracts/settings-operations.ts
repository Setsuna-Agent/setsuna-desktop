import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { agentRecord, agentText, collaborationAgentSettingsCodec, type CollaborationSettingsState, type CollaborationAgentSettings } from './agents.js';

export type CollaborationSettingsUpdate = Readonly<{ expectedRevision: number; settings: CollaborationAgentSettings }>;
const revision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid settings revision.');
  return value as number;
};
const stateCodec = defineRuntimeCodec<CollaborationSettingsState>((value) => {
  const record = agentRecord(value);
  if (!Array.isArray(record.availableModels)) throw new Error('Invalid available agent models.');
  return { settings: collaborationAgentSettingsCodec.parse(record.settings), revision: revision(record.revision),
    availableModels: record.availableModels.map((value) => {
      const model = agentRecord(value);
      if (!Array.isArray(model.reasoningEfforts)) throw new Error('Invalid reasoning efforts.');
      return { providerId: agentText(model.providerId, 256), providerName: agentText(model.providerName, 256),
        modelId: agentText(model.modelId, 256), modelName: agentText(model.modelName, 256), modelCode: agentText(model.modelCode, 256),
        reasoningEfforts: model.reasoningEfforts.map((effort) => agentText(effort, 64)) };
    }),
  };
});
const errors = { SETTINGS_UNAVAILABLE: { status: 503 }, REVISION_CONFLICT: { status: 409 }, INVALID_CONFIGURATION: { status: 400 } } as const;
export const readCollaborationSettings = defineFeatureOperation({
  id: 'collaboration.settings.read', method: 'GET', path: '/v1/features/collaboration/settings',
  input: defineRuntimeCodec<undefined>(() => undefined), output: stateCodec, errors, idempotency: 'safe',
});
export const updateCollaborationSettings = defineFeatureOperation({
  id: 'collaboration.settings.update', method: 'PATCH', path: '/v1/features/collaboration/settings',
  input: defineRuntimeCodec<CollaborationSettingsUpdate>((value) => {
    const record = agentRecord(value);
    return { expectedRevision: revision(record.expectedRevision), settings: collaborationAgentSettingsCodec.parse(record.settings) };
  }), output: stateCodec, errors, idempotency: 'idempotent',
});
