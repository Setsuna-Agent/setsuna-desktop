import type {
  RuntimeBackgroundShellProcess,
  RuntimeBackgroundShellProcessTermination,
  RuntimeTaskKind,
  RuntimeThreadKind,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  RuntimeActiveTask,
  RuntimeActiveTaskState,
  RuntimeActivityList,
  RuntimeActivityServiceTarget,
  RuntimeActivityTaskTarget,
  RuntimeActivityTaskTermination,
  RuntimeBackgroundServiceActivity,
} from './types.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Runtime Activity list does not accept input.');
});

const taskTargetCodec = defineRuntimeCodec<RuntimeActivityTaskTarget>((value) => {
  const record = objectRecord(value, 'Runtime Activity task target must be an object.');
  return Object.freeze({
    threadId: runtimeId(record.threadId, 'threadId'),
    turnId: runtimeId(record.turnId, 'turnId'),
  });
});

const serviceTargetCodec = defineRuntimeCodec<RuntimeActivityServiceTarget>((value) => {
  const record = objectRecord(value, 'Runtime Activity service target must be an object.');
  return Object.freeze({
    processId: runtimeId(record.processId, 'processId'),
    threadId: runtimeId(record.threadId, 'threadId'),
  });
});

const activityListCodec = defineRuntimeCodec<RuntimeActivityList>((value) => {
  const record = objectRecord(value, 'Runtime Activity list must be an object.');
  if (!Array.isArray(record.backgroundServices)) {
    throw new Error('Runtime Activity background services must be an array.');
  }
  if (!Array.isArray(record.tasks)) throw new Error('Runtime Activity tasks must be an array.');
  return Object.freeze({
    backgroundServices: Object.freeze(record.backgroundServices.map(backgroundService)),
    capturedAt: text(record.capturedAt, 'capturedAt'),
    tasks: Object.freeze(record.tasks.map(activeTask)),
  });
});

const taskTerminationCodec = defineRuntimeCodec<RuntimeActivityTaskTermination>((value) => {
  const record = objectRecord(value, 'Runtime Activity task termination must be an object.');
  return Object.freeze({ cancelled: booleanValue(record.cancelled, 'cancelled') });
});

const serviceTerminationCodec = defineRuntimeCodec<RuntimeBackgroundShellProcessTermination>((value) => {
  const record = objectRecord(value, 'Runtime Activity service termination must be an object.');
  return Object.freeze({ terminated: booleanValue(record.terminated, 'terminated') });
});

export const listRuntimeActivities = defineFeatureOperation({
  id: 'runtime-activity.list',
  method: 'GET',
  path: '/v1/features/runtime-activity',
  input: emptyInputCodec,
  output: activityListCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

export const stopRuntimeActivityTask = defineFeatureOperation({
  id: 'runtime-activity.task.stop',
  method: 'DELETE',
  path: '/v1/features/runtime-activity/tasks/:threadId/:turnId',
  input: taskTargetCodec,
  output: taskTerminationCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

export const stopRuntimeActivityService = defineFeatureOperation({
  id: 'runtime-activity.service.stop',
  method: 'DELETE',
  path: '/v1/features/runtime-activity/services/:threadId/:processId',
  input: serviceTargetCodec,
  output: serviceTerminationCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

function activeTask(value: unknown): RuntimeActiveTask {
  const record = objectRecord(value, 'Runtime Activity task must be an object.');
  return Object.freeze({
    archived: booleanValue(record.archived, 'task archived'),
    ...optionalText(record, 'projectId'),
    queuedInputCount: nonNegativeInteger(record.queuedInputCount, 'task queuedInputCount'),
    startedAt: nullableText(record.startedAt, 'task startedAt'),
    state: activeTaskState(record.state),
    taskKind: taskKind(record.taskKind),
    threadId: runtimeId(record.threadId, 'task threadId'),
    threadKind: threadKind(record.threadKind),
    threadTitle: text(record.threadTitle, 'task threadTitle'),
    turnId: runtimeId(record.turnId, 'task turnId'),
    updatedAt: text(record.updatedAt, 'task updatedAt'),
  });
}

function backgroundService(value: unknown): RuntimeBackgroundServiceActivity {
  const record = objectRecord(value, 'Runtime Activity background service must be an object.');
  const process = backgroundShellProcess(record);
  return Object.freeze({
    ...process,
    archived: booleanValue(record.archived, 'service archived'),
    ...optionalText(record, 'projectId'),
    threadKind: threadKind(record.threadKind),
    threadTitle: nullableText(record.threadTitle, 'service threadTitle'),
  });
}

function backgroundShellProcess(record: Record<string, unknown>): RuntimeBackgroundShellProcess {
  return Object.freeze({
    command: text(record.command, 'service command'),
    directory: text(record.directory, 'service directory'),
    expiresAt: nullableText(record.expiresAt, 'service expiresAt'),
    id: runtimeId(record.id, 'service id'),
    startedAt: text(record.startedAt, 'service startedAt'),
    threadId: runtimeId(record.threadId, 'service threadId'),
    toolCallId: nullableText(record.toolCallId, 'service toolCallId'),
    turnId: nullableText(record.turnId, 'service turnId'),
  });
}

function activeTaskState(value: unknown): RuntimeActiveTaskState {
  if (value === 'running' || value === 'waiting_for_approval' || value === 'waiting_for_input') return value;
  throw new Error('Runtime Activity task state is invalid.');
}

function taskKind(value: unknown): RuntimeTaskKind {
  if (
    value === 'regular'
    || value === 'compact'
    || value === 'review'
    || value === 'goal'
    || value === 'user_shell'
    || value === 'subagent'
  ) return value;
  throw new Error('Runtime Activity task kind is invalid.');
}

function threadKind(value: unknown): RuntimeThreadKind {
  if (value === 'regular' || value === 'side') return value;
  throw new Error('Runtime Activity thread kind is invalid.');
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Runtime Activity ${label} is invalid.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Runtime Activity ${label} is invalid.`);
  return value;
}

function runtimeId(value: unknown, label: string): string {
  const id = text(value, label);
  if (!id.trim()) throw new Error(`Runtime Activity ${label} must not be empty.`);
  return id;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? { [key]: value } : {};
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Runtime Activity ${label} is invalid.`);
  }
  return value as number;
}
