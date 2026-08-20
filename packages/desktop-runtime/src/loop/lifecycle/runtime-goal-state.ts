import { createHash } from 'node:crypto';
import {
  cloneRuntimeSkillReferences,
  cloneRuntimeThreadGoal,
  type RuntimeEvent,
  type RuntimeQueuedTurnInput,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalExecutionOptions,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadGoalStatus,
  type RuntimeThreadGoalStopReason,
} from '@setsuna-desktop/contracts';
import type { IdGenerator } from '../../ports/id-generator.js';
import { isGoalToolName } from './runtime-goal-tools.js';

export const MAX_CONSECUTIVE_NO_PROGRESS_TURNS = 3;
export const MAX_AUTOMATIC_GOAL_TURNS = 25;
const MAX_GOAL_OBJECTIVE_LENGTH = 4_000;
const MAX_RECENT_PROGRESS_FINGERPRINTS = MAX_CONSECUTIVE_NO_PROGRESS_TURNS;

export function accountGoalTurn(
  goal: RuntimeThreadGoal,
  events: RuntimeEvent[],
  now: Date,
): RuntimeThreadGoal {
  const tokenCountEvents = events.filter((event) => event.type === 'token.count');
  const tokens = tokenCountEvents.reduce((sum, event) => sum + usageTotal(event.payload.usage), 0)
    || events.filter((event) => event.type === 'turn.completed')
      .reduce((sum, event) => sum + usageTotal(event.payload.usage), 0);
  const started = events.find((event) => event.type === 'turn.started');
  const terminal = [...events].reverse().find((event) =>
    event.type === 'turn.completed'
    || event.type === 'turn.cancelled'
    || event.type === 'runtime.error'
  );
  const startedAt = started ? Date.parse(started.createdAt) : now.getTime();
  const endedAt = terminal ? Date.parse(terminal.createdAt) : now.getTime();
  const elapsedSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, Math.ceil((endedAt - startedAt) / 1_000))
    : 0;
  return {
    ...goal,
    tokensUsed: goal.tokensUsed + tokens,
    timeUsedSeconds: goal.timeUsedSeconds + elapsedSeconds,
    ...(terminal ? {
      accountedThroughSeq: Math.max(goal.accountedThroughSeq ?? 0, terminal.seq),
    } : {}),
  };
}

export function nextGoalSafety(
  previous: RuntimeThreadGoal['safety'],
  events: RuntimeEvent[],
): NonNullable<RuntimeThreadGoal['safety']> {
  const fingerprint = progressFingerprint(events);
  const previousFingerprints = previous?.recentProgressFingerprints?.length
    ? [...previous.recentProgressFingerprints]
    : previous?.lastProgressFingerprint
      ? [previous.lastProgressFingerprint]
      : [];
  const repeatedOrMissing = !fingerprint || previousFingerprints.includes(fingerprint);
  const lastProgressFingerprint = fingerprint ?? previous?.lastProgressFingerprint;
  const recentProgressFingerprints = fingerprint
    ? [...previousFingerprints.filter((item) => item !== fingerprint), fingerprint]
      .slice(-MAX_RECENT_PROGRESS_FINGERPRINTS)
    : previousFingerprints;
  return {
    automaticTurns: (previous?.automaticTurns ?? 0) + 1,
    consecutiveNoProgressTurns: repeatedOrMissing
      ? (previous?.consecutiveNoProgressTurns ?? 0) + 1
      : 0,
    ...(lastProgressFingerprint ? { lastProgressFingerprint } : {}),
    ...(recentProgressFingerprints.length ? { recentProgressFingerprints } : {}),
  };
}

export function normalizeGoalObjective(value: unknown): string {
  if (typeof value !== 'string') throw new Error('goal objective must be a string');
  const objective = value.trim();
  if (!objective) throw new Error('goal objective must not be empty');
  if ([...objective].length > MAX_GOAL_OBJECTIVE_LENGTH) {
    throw new Error(`goal objective must be at most ${MAX_GOAL_OBJECTIVE_LENGTH} characters`);
  }
  return objective;
}

export function normalizeCompletionStatus(value: unknown): 'complete' {
  if (value === 'complete') return value;
  throw new Error('update_goal only accepts status complete');
}

export function nextGoalState(
  threadId: string,
  previous: RuntimeThreadGoal | undefined,
  patch: RuntimeThreadGoalPatch,
  nowDate: Date,
  ids: IdGenerator,
  forceNew: boolean,
): RuntimeThreadGoal {
  const objective = patch.objective === undefined
    ? previous?.objective
    : normalizeGoalObjective(patch.objective);
  if (!objective) throw new Error(`cannot update goal for thread ${threadId}: no goal exists`);
  const status = normalizeGoalStatus(patch.status ?? (forceNew || !previous ? 'active' : previous.status));
  // Explicit creation and restarting a completed Goal are new work; ordinary edits keep identity.
  const replacesGoal = forceNew || !previous || (previous.status === 'complete' && status === 'active');
  const now = epochSeconds(nowDate);
  const resumesGoal = Boolean(previous && previous.status !== 'active' && status === 'active');
  const objectiveChanged = Boolean(previous && previous.objective !== objective);
  return {
    version: 1,
    id: replacesGoal ? ids.id('goal') : previous.id,
    threadId,
    objective,
    status,
    tokenBudget: null,
    tokensUsed: replacesGoal ? 0 : previous.tokensUsed,
    timeUsedSeconds: replacesGoal ? 0 : previous.timeUsedSeconds,
    accountedThroughSeq: replacesGoal ? 0 : previous.accountedThroughSeq,
    createdAt: replacesGoal ? now : previous.createdAt,
    updatedAt: now,
    stopReason: status === 'active' || status === 'complete'
      ? undefined
      : status === 'paused' && patch.status === 'paused'
        ? { code: 'userPaused', message: 'Goal paused by the user.' }
        : previous?.stopReason,
    safety: replacesGoal || resumesGoal || objectiveChanged
      ? { automaticTurns: 0, consecutiveNoProgressTurns: 0 }
      : previous.safety ? cloneRuntimeThreadGoal(previous).safety : undefined,
    execution: replacesGoal
      ? undefined
      : previous.execution
        ? cloneRuntimeThreadGoal(previous).execution
        : undefined,
  };
}

/** Adds identity and safety fields to Goal snapshots written by older app versions. */
export function normalizeRestoredGoal(
  goal: RuntimeThreadGoal,
  ids: IdGenerator,
): RuntimeThreadGoal {
  const legacy = goal as RuntimeThreadGoal & { id?: unknown; version?: unknown };
  const cloned = cloneRuntimeThreadGoal(goal);
  return {
    ...cloned,
    version: 1,
    id: typeof legacy.id === 'string' && legacy.id.trim()
      ? legacy.id
      : ids.id('goal'),
    safety: cloned.safety ?? {
      automaticTurns: 0,
      consecutiveNoProgressTurns: 0,
    },
  };
}

export function sameGoalState(left: RuntimeThreadGoal, right: RuntimeThreadGoal): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function withGoalStatus(
  goal: RuntimeThreadGoal,
  status: RuntimeThreadGoalStatus,
  now: Date,
  stopReason?: RuntimeThreadGoalStopReason,
): RuntimeThreadGoal {
  const cloned = cloneRuntimeThreadGoal(goal);
  return {
    ...cloned,
    status,
    updatedAt: epochSeconds(now),
    stopReason: status === 'active' || status === 'complete' ? undefined : stopReason,
    safety: status === 'active'
      ? { automaticTurns: 0, consecutiveNoProgressTurns: 0 }
      : cloned.safety,
  };
}

export function goalExecutionState(
  input: RuntimeQueuedTurnInput,
  sourceMessageId: string,
): Pick<RuntimeThreadGoal, 'execution'> {
  const execution: RuntimeThreadGoalExecutionOptions = {
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
    modelSelection: input.modelSelection ? { ...input.modelSelection } : undefined,
    sourceMessageId,
    skillIds: input.skillIds ? [...input.skillIds] : undefined,
    skillReferences: cloneRuntimeSkillReferences(input.skillReferences),
    thinking: input.thinking === true,
    thinkingEffort: input.thinking === true ? input.thinkingEffort : undefined,
  };
  return { execution };
}

export function isProviderUsageLimit(message: string): boolean {
  return /(?:insufficient[_ ]quota|billing limit|credit balance|usage limit|quota exceeded)/iu.test(message);
}

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function progressFingerprint(events: RuntimeEvent[]): string | undefined {
  const evidence = events.flatMap((event) => {
    if (
      event.type !== 'tool.completed'
      || event.payload.status !== 'success'
      || isGoalToolName(event.payload.toolName)
    ) return [];
    return [[
      event.payload.toolName,
      event.payload.argumentsPreview ?? '',
      event.payload.resultPreview ?? event.payload.content,
    ].join('\u0000')];
  });
  if (!evidence.length) return undefined;
  return createHash('sha256').update(evidence.join('\u0001')).digest('hex');
}

function usageTotal(
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
): number {
  if (!usage) return 0;
  const total = finiteNonNegative(usage.totalTokens);
  return total || finiteNonNegative(usage.inputTokens) + finiteNonNegative(usage.outputTokens);
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function normalizeGoalStatus(value: unknown): RuntimeThreadGoalStatus {
  if (
    value === 'active'
    || value === 'paused'
    || value === 'blocked'
    || value === 'usageLimited'
    || value === 'budgetLimited'
    || value === 'complete'
  ) return value;
  throw new Error('invalid goal status');
}
