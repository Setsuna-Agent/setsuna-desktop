import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureEventContract,
  type SequencedThreadEventRecord,
} from '@setsuna-desktop/feature-core/events';
import { collaborationFeature } from './definition.js';
import {
  collaborationTaskCodec,
  isTerminalCollaborationTaskStatus,
  type CollaborationState,
  type CollaborationTask,
  type CollaborationTaskStatus,
} from './state.js';

export type CollaborationTaskStatusChange = Readonly<{
  activeTurnId?: string;
  error?: string;
  resultPreview?: string;
  status: CollaborationTaskStatus;
  taskId: string;
}>;

export const collaborationTaskCreatedEvent = defineFeatureEventContract<CollaborationTask>({
  featureId: collaborationFeature.id,
  eventType: 'collaboration.task-created',
  currentVersion: 1,
  codecs: { 1: defineRuntimeCodec((value) => collaborationTaskCodec.parse(value)) },
  migrate: (_version, value) => collaborationTaskCodec.parse(value),
});

export const collaborationTaskStatusChangedEvent = defineFeatureEventContract<CollaborationTaskStatusChange>({
  featureId: collaborationFeature.id,
  eventType: 'collaboration.task-status-changed',
  currentVersion: 1,
  codecs: { 1: defineRuntimeCodec(parseStatusChange) },
  migrate: (_version, value) => parseStatusChange(value),
});

export function reduceCollaborationTaskCreated(
  state: CollaborationState,
  task: CollaborationTask,
): CollaborationState {
  if (state.tasks.some((candidate) => candidate.id === task.id)) return state;
  return Object.freeze({ tasks: Object.freeze([...state.tasks, collaborationTaskCodec.parse(task)]) });
}

export function reduceCollaborationTaskStatusChanged(
  state: CollaborationState,
  change: CollaborationTaskStatusChange,
  record: Pick<SequencedThreadEventRecord, 'createdAt'>,
): CollaborationState {
  const current = state.tasks.find((task) => task.id === change.taskId);
  if (!current) return state;
  const updated = collaborationTaskCodec.parse({
    ...current,
    status: change.status,
    updatedAt: record.createdAt,
    ...(change.activeTurnId !== undefined ? { activeTurnId: change.activeTurnId } : {}),
    ...(change.resultPreview !== undefined ? { resultPreview: change.resultPreview } : {}),
    ...(change.error !== undefined ? { error: change.error } : {}),
    ...(isTerminalCollaborationTaskStatus(change.status)
      ? { completedAt: current.completedAt ?? record.createdAt }
      : {}),
  });
  return Object.freeze({
    tasks: Object.freeze(state.tasks.map((task) => task.id === updated.id ? updated : task)),
  });
}

function parseStatusChange(value: unknown): CollaborationTaskStatusChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Collaboration task status change must be an object.');
  }
  const record = value as Record<string, unknown>;
  const probe = collaborationTaskCodec.parse({
    id: typeof record.taskId === 'string' ? record.taskId : '',
    childThreadId: 'codec_probe',
    title: '',
    objective: '',
    identity: { displayName: 'codec', avatarSeed: 'codec' },
    status: record.status,
    createdAt: 'codec',
    updatedAt: 'codec',
  });
  return Object.freeze({
    taskId: probe.id,
    status: probe.status,
    ...optionalStringField(record, 'activeTurnId'),
    ...optionalStringField(record, 'resultPreview'),
    ...optionalStringField(record, 'error'),
  });
}

function optionalStringField(
  record: Record<string, unknown>,
  key: 'activeTurnId' | 'error' | 'resultPreview',
): Partial<Record<typeof key, string>> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== 'string') throw new Error(`Collaboration ${key} is invalid.`);
  return { [key]: value };
}
