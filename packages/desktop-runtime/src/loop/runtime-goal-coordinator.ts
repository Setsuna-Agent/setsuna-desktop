import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  type RuntimeConfigState,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeTaskKind,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadGoalStatus,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../ports/tool-host.js';
import { neutralizePromptClosingTags } from './prompt-utils.js';

type ActiveGoalTask = {
  taskKind: RuntimeTaskKind;
  turnId: string;
};

type GoalContinuationRun = {
  done: Promise<void>;
  turnId: string;
};

export type GoalToolExecutionResult = {
  content: string;
  data: Record<string, unknown>;
  preview: string;
};

type RuntimeGoalCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  threadStore: ThreadStore;
  activeTask(threadId: string): ActiveGoalTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  createContinuation(threadId: string, goal: RuntimeThreadGoal, contextMessages: RuntimeMessage[]): Promise<GoalContinuationRun>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

const GOAL_TOOL_NAMES = new Set(['get_goal', 'create_goal', 'update_goal']);
const MAX_GOAL_OBJECTIVE_LENGTH = 4_000;
const MAX_CONSECUTIVE_NO_PROGRESS_TURNS = 3;

export const GOAL_TOOL_DEFINITIONS: RuntimeToolDefinition[] = [
  {
    name: 'get_goal',
    description: 'Read the persistent goal for the current thread, including status and budget usage.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_goal',
    description: 'Create a persistent multi-turn goal for this thread. Use only when no unfinished goal exists.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Concrete objective to pursue across turns.' },
        token_budget: { type: 'number', description: 'Optional positive token budget.' },
      },
      required: ['objective'],
    },
  },
  {
    name: 'update_goal',
    description: 'Mark the active goal complete or blocked. Complete is valid only after auditing the objective; blocked requires a genuine impasse.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['complete', 'blocked'] },
      },
      required: ['status'],
    },
  },
];

export function goalToolsEnabled(config: RuntimeConfigState | null | undefined, threadHasGoal = false): boolean {
  return threadHasGoal || config?.features?.goals === true;
}

export function isGoalToolName(name: string): boolean {
  return GOAL_TOOL_NAMES.has(name);
}

/** Owns persistent goal state, accounting, model tools, and idle-turn continuation. */
export class RuntimeGoalCoordinator {
  private readonly scheduling = new Set<string>();
  private readonly noProgressTurns = new Map<string, number>();
  private stopped = false;

  constructor(private readonly options: RuntimeGoalCoordinatorOptions) {}

  shutdown(): void {
    this.stopped = true;
    this.scheduling.clear();
  }

  async getGoal(threadId: string): Promise<RuntimeThreadGoal | null> {
    const thread = await this.requireThread(threadId);
    return thread.goal ? { ...thread.goal } : null;
  }

  async setGoal(threadId: string, patch: RuntimeThreadGoalPatch, options: { cancelActiveGoalTurn?: boolean } = {}): Promise<RuntimeThreadGoal> {
    const thread = await this.requireThread(threadId);
    const previous = thread.goal;
    const objective = patch.objective === undefined ? previous?.objective : normalizeObjective(patch.objective);
    if (!objective) throw new Error(`cannot update goal for thread ${threadId}: no goal exists`);
    const status = normalizeGoalStatus(patch.status ?? previous?.status ?? 'active');
    const tokenBudget = patch.tokenBudget === undefined ? previous?.tokenBudget ?? null : normalizeTokenBudget(patch.tokenBudget);
    const now = epochSeconds(this.options.clock.now());
    const replacesTerminalGoal = Boolean(previous && previous.objective !== objective && isTerminalGoalStatus(previous.status));
    const goal: RuntimeThreadGoal = {
      threadId,
      objective,
      status,
      tokenBudget,
      tokensUsed: replacesTerminalGoal ? 0 : previous?.tokensUsed ?? 0,
      timeUsedSeconds: replacesTerminalGoal ? 0 : previous?.timeUsedSeconds ?? 0,
      createdAt: replacesTerminalGoal ? now : previous?.createdAt ?? now,
      updatedAt: now,
    };
    await this.publishGoal(goal);
    if (!previous && thread.title === DEFAULT_THREAD_TITLE) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        type: 'thread.updated',
        createdAt: this.options.clock.now().toISOString(),
        payload: { title: fallbackThreadTitle(objective) },
      });
    }
    const active = this.options.activeTask(threadId);
    if (goal.status !== 'active' && options.cancelActiveGoalTurn !== false && active?.taskKind === 'goal') {
      await this.options.cancelTurn(threadId, active.turnId);
    }
    if (goal.status === 'active') await this.continueIfIdle(threadId);
    return goal;
  }

  async clearGoal(threadId: string): Promise<void> {
    await this.requireThread(threadId);
    const active = this.options.activeTask(threadId);
    if (active?.taskKind === 'goal') await this.options.cancelTurn(threadId, active.turnId);
    this.noProgressTurns.delete(threadId);
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'thread.goal_cleared',
      createdAt: this.options.clock.now().toISOString(),
      payload: { cleared: true },
    });
  }

  async resumeIfActive(threadId: string): Promise<void> {
    await this.continueIfIdle(threadId);
  }

  async pauseForCancellation(threadId: string): Promise<void> {
    const goal = await this.getGoal(threadId);
    if (goal?.status === 'active') await this.updateStatus(goal, 'paused');
  }

  observeRun(threadId: string, turnId: string, taskKind: RuntimeTaskKind, done: Promise<void>): void {
    void done.then(
      () => this.onTurnSettled(threadId, turnId, taskKind),
      () => this.onTurnSettled(threadId, turnId, taskKind),
    ).catch(() => undefined);
  }

  async execute(name: string, parsedArguments: unknown, context: RuntimeToolExecutionContext): Promise<GoalToolExecutionResult> {
    const input = recordInput(parsedArguments);
    if (name === 'get_goal') {
      const goal = await this.getGoal(context.threadId);
      return goalToolResult(name, { goal }, goal ? `Goal is ${goal.status}.` : 'No goal is set.');
    }
    if (name === 'create_goal') {
      const existing = await this.getGoal(context.threadId);
      if (existing && !isTerminalGoalStatus(existing.status)) throw new Error('An unfinished goal already exists. Update it instead of creating another goal.');
      const objective = normalizeObjective(input.objective);
      const tokenBudget = input.token_budget === undefined ? null : normalizeTokenBudget(input.token_budget);
      const goal = await this.setGoal(context.threadId, { objective, status: 'active', tokenBudget });
      return goalToolResult(name, { goal }, 'Goal created.');
    }
    if (name === 'update_goal') {
      const status = goalTerminalStatus(input.status);
      const goal = await this.setGoal(context.threadId, { status }, { cancelActiveGoalTurn: false });
      return goalToolResult(name, { goal }, `Goal marked ${status}.`);
    }
    throw new Error(`Unknown goal tool: ${name}`);
  }

  private async continueIfIdle(threadId: string): Promise<void> {
    if (this.stopped || this.scheduling.has(threadId) || this.options.activeTask(threadId)) return;
    this.scheduling.add(threadId);
    try {
      const goal = await this.getGoal(threadId);
      if (!goal || goal.status !== 'active' || this.options.activeTask(threadId)) return;
      if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
        await this.updateStatus(goal, 'budgetLimited');
        return;
      }
      const run = await this.options.createContinuation(threadId, goal, goalContinuationMessages(goal, this.options.ids, this.options.clock));
      this.observeRun(threadId, run.turnId, 'goal', run.done);
      void run.done.catch(() => undefined);
    } finally {
      this.scheduling.delete(threadId);
    }
  }

  private async onTurnSettled(threadId: string, turnId: string, taskKind: RuntimeTaskKind): Promise<void> {
    const goal = await this.getGoal(threadId);
    if (!goal) return;
    if (taskKind !== 'goal') {
      if (goal.status === 'active') await this.continueIfIdle(threadId);
      return;
    }

    const events = (await this.options.threadStore.listEvents(threadId)).filter((event) => event.turnId === turnId);
    const accounted = accountGoalTurn(goal, events, this.options.clock.now());
    let nextStatus = accounted.status;
    if (nextStatus === 'active' && events.some((event) => event.type === 'turn.cancelled')) nextStatus = 'paused';
    if (nextStatus === 'active' && events.some((event) => event.type === 'runtime.error')) nextStatus = 'blocked';
    if (nextStatus === 'active' && accounted.tokenBudget !== null && accounted.tokensUsed >= accounted.tokenBudget) nextStatus = 'budgetLimited';

    if (nextStatus === 'active') {
      const madeProgress = events.some((event) => event.type === 'tool.completed'
        && event.payload.status === 'success'
        && !isGoalToolName(event.payload.toolName));
      const noProgress = madeProgress ? 0 : (this.noProgressTurns.get(threadId) ?? 0) + 1;
      this.noProgressTurns.set(threadId, noProgress);
      if (noProgress >= MAX_CONSECUTIVE_NO_PROGRESS_TURNS) nextStatus = 'blocked';
    } else {
      this.noProgressTurns.delete(threadId);
    }

    const updated = { ...accounted, status: nextStatus, updatedAt: epochSeconds(this.options.clock.now()) };
    await this.publishGoal(updated);
    if (updated.status === 'active') await this.continueIfIdle(threadId);
  }

  private async updateStatus(goal: RuntimeThreadGoal, status: RuntimeThreadGoalStatus): Promise<void> {
    await this.publishGoal({ ...goal, status, updatedAt: epochSeconds(this.options.clock.now()) });
  }

  private async publishGoal(goal: RuntimeThreadGoal): Promise<void> {
    await this.options.appendEvent(goal.threadId, {
      id: this.options.ids.id('event'),
      threadId: goal.threadId,
      type: 'thread.goal_updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: { goal },
    });
  }

  private async requireThread(threadId: string) {
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }
}

function goalContinuationMessages(goal: RuntimeThreadGoal, ids: IdGenerator, clock: Clock): RuntimeMessage[] {
  const budget = goal.tokenBudget === null
    ? 'No token budget is configured.'
    : `${Math.max(0, goal.tokenBudget - goal.tokensUsed)} of ${goal.tokenBudget} goal tokens remain.`;
  return [{
    id: ids.id('msg_goal_policy'),
    turnId: `goal:${goal.threadId}`,
    role: 'developer',
    promptSource: 'goal',
    createdAt: clock.now().toISOString(),
    status: 'complete',
    content: [
      'You are executing a persistent multi-turn goal managed by the runtime.',
      'Continue making concrete progress. A normal assistant answer ends only the current turn, not the goal.',
      'Use get_goal when you need current counters. Before completion, audit the full objective and remaining work.',
      'Call update_goal with status complete only when the entire objective is achieved and verified.',
      'Call update_goal with status blocked only for a genuine impasse that requires user input or an external state change.',
    ].join('\n'),
  }, {
    id: ids.id('msg_goal_context'),
    turnId: `goal:${goal.threadId}`,
    role: 'user',
    promptSource: 'goal',
    createdAt: clock.now().toISOString(),
    status: 'complete',
    content: [
      '<goal_context>',
      `Objective:\n${neutralizePromptClosingTags(goal.objective, ['goal_context'])}`,
      `Budget: ${budget}`,
      '</goal_context>',
    ].join('\n'),
  }];
}

function accountGoalTurn(goal: RuntimeThreadGoal, events: RuntimeEvent[], now: Date): RuntimeThreadGoal {
  const tokenCountEvents = events.filter((event) => event.type === 'token.count');
  const tokens = tokenCountEvents.reduce((sum, event) => sum + usageTotal(event.payload.usage), 0)
    || events.filter((event) => event.type === 'turn.completed').reduce((sum, event) => sum + usageTotal(event.payload.usage), 0);
  const started = events.find((event) => event.type === 'turn.started');
  const terminal = [...events].reverse().find((event) => event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error');
  const startedAt = started ? Date.parse(started.createdAt) : now.getTime();
  const endedAt = terminal ? Date.parse(terminal.createdAt) : now.getTime();
  const elapsedSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, Math.ceil((endedAt - startedAt) / 1_000))
    : 0;
  return {
    ...goal,
    tokensUsed: goal.tokensUsed + tokens,
    timeUsedSeconds: goal.timeUsedSeconds + elapsedSeconds,
  };
}

function usageTotal(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): number {
  if (!usage) return 0;
  const total = finiteNonNegative(usage.totalTokens);
  return total || finiteNonNegative(usage.inputTokens) + finiteNonNegative(usage.outputTokens);
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeObjective(value: unknown): string {
  if (typeof value !== 'string') throw new Error('goal objective must be a string');
  const objective = value.trim();
  if (!objective) throw new Error('goal objective must not be empty');
  if ([...objective].length > MAX_GOAL_OBJECTIVE_LENGTH) throw new Error(`goal objective must be at most ${MAX_GOAL_OBJECTIVE_LENGTH} characters`);
  return objective;
}

function normalizeTokenBudget(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('goal token budget must be a positive number or null');
  return Math.floor(value);
}

function goalTerminalStatus(value: unknown): 'complete' | 'blocked' {
  if (value === 'complete' || value === 'blocked') return value;
  throw new Error('goal status must be complete or blocked');
}

function normalizeGoalStatus(value: unknown): RuntimeThreadGoalStatus {
  if (value === 'active' || value === 'paused' || value === 'blocked' || value === 'usageLimited' || value === 'budgetLimited' || value === 'complete') return value;
  throw new Error('invalid goal status');
}

function isTerminalGoalStatus(status: RuntimeThreadGoalStatus): boolean {
  return status === 'complete' || status === 'blocked' || status === 'budgetLimited' || status === 'usageLimited';
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function goalToolResult(name: string, data: Record<string, unknown>, preview: string): GoalToolExecutionResult {
  return { content: JSON.stringify({ tool: name, ...data }), data, preview };
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}
