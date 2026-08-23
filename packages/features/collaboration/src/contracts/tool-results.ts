import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  collaborationAgentIdentityCodec,
  type CollaborationAgentIdentity,
  type CollaborationTaskStatus,
} from './state.js';

export type CollaborationSpawnResult = Readonly<{
  childThreadId: string;
  identity: CollaborationAgentIdentity;
  objective: string;
  parentThreadId: string;
  status: CollaborationTaskStatus;
  taskId: string;
  title: string;
  turnId: string;
}>;

export const collaborationSpawnResultCodec = defineRuntimeCodec<CollaborationSpawnResult>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Collaboration spawn result must be an object.');
  }
  const record = value as Record<string, unknown>;
  const required = (key: 'childThreadId' | 'objective' | 'parentThreadId' | 'taskId' | 'title' | 'turnId') => {
    const field = record[key];
    if (typeof field !== 'string' || (key !== 'title' && !field)) {
      throw new Error(`Collaboration spawn result ${key} is invalid.`);
    }
    return field;
  };
  const status = record.status;
  if (status !== 'queued' && status !== 'running') {
    throw new Error('Collaboration spawn result status is invalid.');
  }
  return Object.freeze({
    childThreadId: required('childThreadId'),
    identity: collaborationAgentIdentityCodec.parse(record.identity),
    objective: required('objective'),
    parentThreadId: required('parentThreadId'),
    status,
    taskId: required('taskId'),
    title: required('title'),
    turnId: required('turnId'),
  });
});

export function isLegacyCollaborationSpawnResult(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).tool === 'spawn_agent',
  );
}

/** Upgrades the flat spawn_agent result persisted before Feature result envelopes existed. */
export const collaborationLegacySpawnResultCodec = defineRuntimeCodec<CollaborationSpawnResult>((value) => {
  if (!isLegacyCollaborationSpawnResult(value)) {
    throw new Error('Legacy collaboration result is not a spawn_agent result.');
  }
  const record = value as Record<string, unknown>;
  return collaborationSpawnResultCodec.parse({
    childThreadId: record.childThreadId ?? record.newThreadId,
    identity: record.identity,
    objective: record.objective,
    parentThreadId: record.senderThreadId,
    status: record.status,
    taskId: record.taskId,
    title: record.title,
    turnId: record.turnId,
  });
});

export function collaborationSpawnResultEnvelope(payload: CollaborationSpawnResult): Readonly<{
  resultKind: 'collaboration.spawn-result';
  resultMajor: 1;
  payload: CollaborationSpawnResult;
}> {
  return Object.freeze({
    resultKind: 'collaboration.spawn-result',
    resultMajor: 1,
    payload: collaborationSpawnResultCodec.parse(payload),
  });
}
