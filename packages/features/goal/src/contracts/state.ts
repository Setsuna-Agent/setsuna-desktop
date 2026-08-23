import {
  cloneRuntimeThreadGoal,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadGoalStatus,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export type Goal = RuntimeThreadGoal;
export type GoalPatch = RuntimeThreadGoalPatch;
export type GoalStatus = RuntimeThreadGoalStatus;

export type GoalState = Readonly<{ goal: Goal | null }>;
export type GoalStateSnapshot = Readonly<{
  state: GoalState;
  throughSeq: number;
}>;

const GOAL_STATUSES = new Set<GoalStatus>([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
]);

export const goalCodec = defineRuntimeCodec<Goal>((value) => {
  const record = objectRecord(value, 'Goal must be an object.');
  if (
    record.version !== 1
    || typeof record.id !== 'string'
    || !record.id
    || typeof record.threadId !== 'string'
    || !record.threadId
    || typeof record.objective !== 'string'
    || !record.objective.trim()
    || typeof record.status !== 'string'
    || !GOAL_STATUSES.has(record.status as GoalStatus)
  ) throw new Error('Goal identity or status is invalid.');
  nonNegativeNumber(record.tokensUsed, 'Goal tokensUsed');
  nonNegativeNumber(record.timeUsedSeconds, 'Goal timeUsedSeconds');
  nonNegativeNumber(record.createdAt, 'Goal createdAt');
  nonNegativeNumber(record.updatedAt, 'Goal updatedAt');
  if (record.tokenBudget !== null) nonNegativeNumber(record.tokenBudget, 'Goal tokenBudget');
  if (record.accountedThroughSeq !== undefined) {
    nonNegativeInteger(record.accountedThroughSeq, 'Goal accountedThroughSeq');
  }
  validateGoalNestedState(record);
  return cloneRuntimeThreadGoal(record as Goal);
});

export const goalPatchCodec = defineRuntimeCodec<GoalPatch>((value) => {
  const record = objectRecord(value, 'Goal patch must be an object.');
  if (Object.keys(record).some((key) => key !== 'objective' && key !== 'status')) {
    throw new Error('Goal patch contains unsupported fields.');
  }
  if (record.objective !== undefined && typeof record.objective !== 'string') {
    throw new Error('Goal objective patch must be a string.');
  }
  if (
    record.status !== undefined
    && (typeof record.status !== 'string' || !GOAL_STATUSES.has(record.status as GoalStatus))
  ) throw new Error('Goal status patch is invalid.');
  if (record.objective === undefined && record.status === undefined) {
    throw new Error('Goal patch must change objective or status.');
  }
  return Object.freeze({
    ...(typeof record.objective === 'string' ? { objective: record.objective } : {}),
    ...(typeof record.status === 'string' ? { status: record.status as GoalStatus } : {}),
  });
});

export const goalStateCodec = defineRuntimeCodec<GoalState>((value) => {
  const record = objectRecord(value, 'Goal state must be an object.');
  return Object.freeze({ goal: record.goal === null ? null : goalCodec.parse(record.goal) });
});

export const goalStateSnapshotCodec = defineRuntimeCodec<GoalStateSnapshot>((value) => {
  const record = objectRecord(value, 'Goal state snapshot must be an object.');
  return Object.freeze({
    state: goalStateCodec.parse(record.state),
    throughSeq: nonNegativeInteger(record.throughSeq, 'Goal snapshot throughSeq'),
  });
});

export function createInitialGoalState(): GoalState {
  return Object.freeze({ goal: null });
}

export function cloneGoalState(state: GoalState): GoalState {
  return Object.freeze({ goal: state.goal ? goalCodec.parse(state.goal) : null });
}

function validateGoalNestedState(record: Record<string, unknown>): void {
  if (record.stopReason !== undefined) objectRecord(record.stopReason, 'Goal stopReason must be an object.');
  if (record.safety !== undefined) {
    const safety = objectRecord(record.safety, 'Goal safety must be an object.');
    nonNegativeInteger(safety.automaticTurns, 'Goal automaticTurns');
    nonNegativeInteger(safety.consecutiveNoProgressTurns, 'Goal consecutiveNoProgressTurns');
    if (safety.recentProgressFingerprints !== undefined && !stringArray(safety.recentProgressFingerprints)) {
      throw new Error('Goal recent progress fingerprints are invalid.');
    }
  }
  if (record.execution !== undefined) {
    const execution = objectRecord(record.execution, 'Goal execution must be an object.');
    for (const key of ['attachments', 'skillIds', 'skillReferences'] as const) {
      if (execution[key] !== undefined && !Array.isArray(execution[key])) {
        throw new Error(`Goal execution ${key} must be an array.`);
      }
    }
  }
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = nonNegativeNumber(value, label);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is invalid.`);
  return number;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
