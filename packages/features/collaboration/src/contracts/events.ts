import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureEventContract,
  type SequencedThreadEventRecord,
} from '@setsuna-desktop/feature-core/events';
import { collaborationFeature } from './definition.js';
import { collaborationExecutionCodec, type CollaborationExecution } from './execution.js';
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
  return Object.freeze({ ...state, tasks: Object.freeze([...state.tasks, collaborationTaskCodec.parse(task)]) });
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
    ...state,
    tasks: Object.freeze(state.tasks.map((task) => task.id === updated.id ? updated : task)),
  });
}

export const collaborationExecutionChangedEvent = defineFeatureEventContract<CollaborationExecution>({
  featureId: collaborationFeature.id,
  eventType: 'collaboration.execution-changed',
  currentVersion: 1,
  codecs: { 1: collaborationExecutionCodec },
  migrate: (_version, value) => collaborationExecutionCodec.parse(value),
});

export function reduceCollaborationExecutionChanged(state: CollaborationState, execution: CollaborationExecution): CollaborationState {
  if (!state.tasks.some((task) => task.id === execution.taskId)) return state;
  const existing = state.executions.find((entry) => entry.turnId === execution.turnId);
  // Ownership and terminal outcomes cannot be rewritten by a late event or a delivery receipt.
  if (existing && (existing.taskId !== execution.taskId || existing.parentTurnId !== execution.parentTurnId
    || (isTerminalCollaborationTaskStatus(existing.status) && existing.status !== execution.status)
    || (existing.delivery !== 'pending' && existing.delivery !== execution.delivery))) return state;
  const executions = existing
    ? state.executions.map((entry) => entry.turnId === execution.turnId ? execution : entry)
    : [...state.executions, execution];
  const latest = executions.filter((entry) => entry.taskId === execution.taskId).at(-1);
  return Object.freeze({
    executions: Object.freeze(executions),
    tasks: Object.freeze(state.tasks.map((task) => {
      if (task.id !== execution.taskId || latest?.turnId !== execution.turnId) return task;
      if (existing && existing.status === execution.status && existing.error === execution.error
        && existing.resultPreview === execution.resultPreview) return task;
      const { error: _error, resultPreview: _preview, completedAt: _completed, ...base } = task;
      return collaborationTaskCodec.parse({
        ...base, activeTurnId: execution.turnId, status: execution.status, updatedAt: execution.updatedAt,
        ...(execution.error ? { error: execution.error } : {}),
        ...(execution.resultPreview ? { resultPreview: execution.resultPreview } : {}),
        ...(isTerminalCollaborationTaskStatus(execution.status) ? { completedAt: task.activeTurnId === execution.turnId ? task.completedAt ?? execution.updatedAt : execution.updatedAt } : {}),
      });
    })),
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
