import {
  cloneRuntimeThreadGoal,
  type RuntimeThreadGoal,
} from '@setsuna-desktop/contracts';
import {
  FeatureEventRegistry,
  type SequencedThreadEventRecord,
} from '@setsuna-desktop/feature-core/events';
import {
  createInitialGoalState,
  goalCodec,
  goalFeature,
  goalStateReplacedEvent,
  reduceGoalState,
  type GoalState,
} from '../contracts/index.js';
import { normalizeRestoredGoal } from './runtime-goal-state.js';

type LegacyGoalUpdate = Readonly<{
  goal: RuntimeThreadGoal;
  preserveExecution: boolean;
}>;

export function createRuntimeGoalEventRegistry(): FeatureEventRegistry<GoalState> {
  const registry = new FeatureEventRegistry<GoalState>(goalFeature.id);
  registry.register(goalStateReplacedEvent, (state, value) => reduceGoalState(state, value));
  registry.registerLegacy('thread.goal_updated', decodeLegacyGoalUpdate, (state, update) => {
    const execution = update.preserveExecution ? state.goal?.execution : update.goal.execution;
    return Object.freeze({
      goal: cloneRuntimeThreadGoal({
        ...update.goal,
        ...(execution ? { execution } : { execution: undefined }),
      }),
    });
  });
  registry.registerLegacy('thread.goal_cleared', decodeLegacyGoalClear, (state, cleared) => (
    cleared ? createInitialGoalState() : state
  ));
  return registry;
}

function decodeLegacyGoalUpdate(record: SequencedThreadEventRecord): LegacyGoalUpdate {
  const payload = objectRecord(record.payload, 'Legacy Goal update payload is invalid.');
  const rawGoal = objectRecord(payload.goal, 'Legacy Goal snapshot is invalid.');
  const normalized = normalizeRestoredGoal(rawGoal as RuntimeThreadGoal, {
    id: () => `goal_legacy_${safeIdentity(record.id)}_${record.seq}`,
  });
  if (normalized.threadId !== record.threadId) {
    throw new Error('Legacy Goal thread identity does not match its event.');
  }
  return Object.freeze({
    goal: goalCodec.parse(normalized),
    preserveExecution: payload.preserveExecution === true,
  });
}

function decodeLegacyGoalClear(record: SequencedThreadEventRecord): boolean {
  const payload = objectRecord(record.payload, 'Legacy Goal clear payload is invalid.');
  if (typeof payload.cleared !== 'boolean') throw new Error('Legacy Goal clear marker is invalid.');
  return payload.cleared;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function safeIdentity(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 80) || 'event';
}
