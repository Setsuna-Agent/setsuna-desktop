import type {
  PendingStoredThreadEvent,
  RuntimeMessage,
  RuntimeQueuedTurnInput,
  RuntimeTaskKind,
  RuntimeThread,
  RuntimeThreadGoalExecutionOptions,
  RuntimeThreadGoalPatch,
  RuntimeThreadSummary,
  RuntimeToolDefinition,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { Goal, GoalStateSnapshot } from './state.js';

export type GoalTask = Readonly<{
  taskKind: RuntimeTaskKind;
  turnId: string;
}>;

export type GoalContinuationRun = Readonly<{
  done: Promise<void>;
  turnId: string;
}>;

export type GoalToolExecutionContext = Readonly<{
  goalExecution?: RuntimeThreadGoalExecutionOptions;
  threadId: string;
  turnId: string;
}>;

export type GoalToolExecutionResult = Readonly<{
  content: string;
  data: Record<string, unknown>;
  preview: string;
}>;

export interface GoalRuntimeHost {
  now(): Date;
  id(prefix: string): string;
  listThreads(): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  listEvents(threadId: string): Promise<StoredThreadEvent[]>;
  activeTask(threadId: string): GoalTask | null;
  registeredTask(threadId: string): GoalTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  createContinuation(
    threadId: string,
    goal: Goal,
    options?: Readonly<{ turnId?: string }>,
  ): Promise<GoalContinuationRun>;
  hasQueuedInput(threadId: string): Promise<boolean>;
  waitForCancellationWrites(threadId: string): Promise<void>;
  appendEvents(
    threadId: string,
    events: readonly PendingStoredThreadEvent[],
  ): Promise<StoredThreadEvent[]>;
}

/** The only Goal surface consumed by Agent Loop and protocol adapters. */
export interface GoalControl {
  readonly available: boolean;
  shutdown(): void;
  readState(threadId: string): Promise<GoalStateSnapshot>;
  getGoal(threadId: string): Promise<Goal | null>;
  isCompletionPending(turnId: string, goalId: string): boolean;
  reconcileRestoredGoals(): Promise<void>;
  validateQueuedGoal(threadId: string, objective: string): Promise<void>;
  setGoal(threadId: string, patch: RuntimeThreadGoalPatch): Promise<Goal>;
  startQueuedGoal(threadId: string, input: RuntimeQueuedTurnInput): Promise<GoalContinuationRun>;
  clearGoal(threadId: string): Promise<void>;
  resumeGoal(threadId: string): Promise<void>;
  pauseForCancellation(threadId: string): Promise<void>;
  observeRun(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    done: Promise<void>,
    goalId?: string,
    goalObjective?: string,
  ): void;
  beginThreadDeletion(threadId: string): void;
  waitForThreadDeletionPause(threadId: string): Promise<void>;
  waitForSettlements(): Promise<void>;
  finishThreadDeletion(threadId: string, deleted: boolean): void;
  execute(
    name: string,
    parsedArguments: unknown,
    context: GoalToolExecutionContext,
  ): Promise<GoalToolExecutionResult>;
  toolDefinitions(goal: Goal | null | undefined, completionPending?: boolean): RuntimeToolDefinition[];
  isToolName(name: string): boolean;
  continuationContextMessages(goal: Goal): RuntimeMessage[];
}

export const goalControlCapability: CapabilityToken<GoalControl> = defineCapability({
  id: 'goal.control',
  major: 1,
  description: 'Control persistent Goal lifecycle without exposing its coordinator or projection',
});

export const goalRuntimeHostCapability: CapabilityToken<GoalRuntimeHost> = defineCapability({
  id: 'goal.runtime-host',
  major: 1,
  description: 'Narrow Agent Loop and event services required by the Goal runtime Feature',
});

export function createNoopGoalControl(): GoalControl {
  const unavailable = (): never => {
    throw new FeatureOperationFailure({
      code: 'FEATURE_UNAVAILABLE',
      message: 'Goal Feature is unavailable.',
      retryable: true,
    });
  };
  return Object.freeze({
    available: false,
    shutdown: () => undefined,
    readState: async () => unavailable(),
    getGoal: async () => null,
    isCompletionPending: () => false,
    reconcileRestoredGoals: async () => undefined,
    validateQueuedGoal: async () => unavailable(),
    setGoal: async () => unavailable(),
    startQueuedGoal: async () => unavailable(),
    clearGoal: async () => undefined,
    resumeGoal: async () => unavailable(),
    pauseForCancellation: async () => undefined,
    observeRun: () => undefined,
    beginThreadDeletion: () => undefined,
    waitForThreadDeletionPause: async () => undefined,
    waitForSettlements: async () => undefined,
    finishThreadDeletion: () => undefined,
    execute: async () => unavailable(),
    toolDefinitions: () => [],
    isToolName: () => false,
    continuationContextMessages: () => [],
  });
}
