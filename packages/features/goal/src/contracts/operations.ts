import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import {
  goalPatchCodec,
  goalStateSnapshotCodec,
  type GoalPatch,
  type GoalStateSnapshot,
} from './state.js';

export type GoalThreadInput = Readonly<{ threadId: string }>;
export type GoalStateUpdateInput = Readonly<{ threadId: string; patch: GoalPatch }>;

const goalThreadErrors = Object.freeze({
  THREAD_NOT_FOUND: Object.freeze({ status: 404 }),
});

const goalUpdateErrors = Object.freeze({
  ...goalThreadErrors,
  GOAL_CONFLICT: Object.freeze({ status: 409 }),
});

const goalThreadInputCodec = defineRuntimeCodec<GoalThreadInput>((value) => {
  const record = objectRecord(value);
  return Object.freeze({ threadId: runtimeId(record.threadId) });
});

const goalStateUpdateInputCodec = defineRuntimeCodec<GoalStateUpdateInput>((value) => {
  const record = objectRecord(value);
  return Object.freeze({
    threadId: runtimeId(record.threadId),
    patch: goalPatchCodec.parse(record.patch),
  });
});

export const readGoalState = defineFeatureOperation<
  GoalThreadInput,
  GoalStateSnapshot,
  typeof goalThreadErrors
>({
  id: 'goal.state.read',
  method: 'GET',
  path: '/v1/features/goal/threads/:threadId/state',
  input: goalThreadInputCodec,
  output: goalStateSnapshotCodec,
  errors: goalThreadErrors,
  idempotency: 'safe',
});

export const updateGoalState = defineFeatureOperation<
  GoalStateUpdateInput,
  GoalStateSnapshot,
  typeof goalUpdateErrors
>({
  id: 'goal.state.update',
  method: 'PATCH',
  path: '/v1/features/goal/threads/:threadId/state',
  input: goalStateUpdateInputCodec,
  output: goalStateSnapshotCodec,
  errors: goalUpdateErrors,
  idempotency: 'idempotent',
});

export const clearGoalState = defineFeatureOperation<
  GoalThreadInput,
  GoalStateSnapshot,
  typeof goalThreadErrors
>({
  id: 'goal.state.clear',
  method: 'DELETE',
  path: '/v1/features/goal/threads/:threadId/state',
  input: goalThreadInputCodec,
  output: goalStateSnapshotCodec,
  errors: goalThreadErrors,
  idempotency: 'idempotent',
});

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Goal operation input must be an object.');
  }
  return value as Record<string, unknown>;
}

function runtimeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Goal threadId is invalid.');
  }
  return value;
}
