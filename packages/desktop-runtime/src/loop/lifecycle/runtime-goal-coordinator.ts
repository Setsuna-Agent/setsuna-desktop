import {
  cloneRuntimeSkillReferences,
  cloneRuntimeThreadGoal,
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeConfigState,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeQueuedTurnInput,
  type RuntimeTaskKind,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalExecutionOptions,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadGoalStatus,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { recordInput } from '../../shared/unknown.js';
import { neutralizePromptClosingTags } from '../context/prompt-utils.js';

type ActiveGoalTask = {
  taskKind: RuntimeTaskKind;
  turnId: string;
};

type GoalContinuationRun = {
  done: Promise<void>;
  turnId: string;
};

type GoalContinuationOptions = {
  turnId?: string;
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
  createContinuation(
    threadId: string,
    goal: RuntimeThreadGoal,
    contextMessages: RuntimeMessage[],
    options?: GoalContinuationOptions,
  ): Promise<GoalContinuationRun>;
  hasQueuedInput?(threadId: string): Promise<boolean>;
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

/** 管理持久化目标状态、计量、模型工具及空闲轮次续接。 */
export class RuntimeGoalCoordinator {
  private readonly scheduling = new Set<string>();
  private readonly noProgressTurns = new Map<string, number>();
  private readonly deletionPausedThreads = new Set<string>();
  private readonly pendingSettlements = new Map<string, Set<Promise<void>>>();
  private stopped = false;

  constructor(private readonly options: RuntimeGoalCoordinatorOptions) {}

  shutdown(): void {
    this.stopped = true;
    this.scheduling.clear();
  }

  async getGoal(threadId: string): Promise<RuntimeThreadGoal | null> {
    const thread = await this.requireThread(threadId);
    return thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
  }

  /**
   * 在队列事件落盘前复用 Goal 的完整领域校验，避免客户端收到失败后重试出重复项。
   */
  async validateQueuedGoal(threadId: string, objective: string): Promise<void> {
    normalizeObjective(objective);
    const thread = await this.requireThread(threadId);
    assertNoUnfinishedGoal(thread.goal);
  }

  async setGoal(threadId: string, patch: RuntimeThreadGoalPatch, options: { cancelActiveGoalTurn?: boolean } = {}): Promise<RuntimeThreadGoal> {
    const thread = await this.requireThread(threadId);
    if (
      (patch.objective !== undefined || patch.status === 'active')
      && thread.queuedTurnInputs?.some((input) =>
        normalizeRuntimeQueuedTurnInputKind(input.kind) === 'goal'
      )
    ) {
      throw new Error('A queued goal already exists. Edit or remove it before setting another goal.');
    }
    const previous = thread.goal;
    const goal = nextGoalState(threadId, previous, patch, this.options.clock.now());
    await this.publishGoal(goal, {
      preserveExecution: Boolean(previous?.execution && goal.execution),
    });
    if (!previous) await this.updateDefaultTitle(threadId, thread.title, goal.objective);
    const active = this.options.activeTask(threadId);
    if (goal.status !== 'active' && options.cancelActiveGoalTurn !== false && active?.taskKind === 'goal') {
      await this.options.cancelTurn(threadId, active.turnId);
    }
    if (goal.status === 'active') await this.continueIfIdle(threadId);
    return goal;
  }

  /**
   * 将队列中的 Goal 项原子转换为线程目标并启动首轮执行。
   *
   * goal_updated 事件同时消费 queuedInputId，并写入带 Goal 类型的可见用户消息，
   * 避免目标、transcript 和队列之间出现部分提交；后续项仍按 FIFO 调度。
   */
  async startQueuedGoal(
    threadId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<GoalContinuationRun> {
    if (
      this.stopped
      || this.deletionPausedThreads.has(threadId)
      || this.scheduling.has(threadId)
      || this.options.activeTask(threadId)
    ) {
      throw new Error(`Thread is not idle for queued goal: ${threadId}`);
    }

    this.scheduling.add(threadId);
    try {
      const thread = await this.requireThread(threadId);
      assertNoUnfinishedGoal(thread.goal);
      const objective = normalizeObjective(input.input);
      const turnId = this.options.ids.id('turn_goal');
      const createdAt = this.options.clock.now().toISOString();
      const sourceMessage: RuntimeMessage = {
        id: this.options.ids.id('msg'),
        clientId: input.clientId,
        turnId,
        role: 'user',
        inputKind: 'goal',
        content: objective,
        skillIds: input.skillIds?.length ? [...input.skillIds] : undefined,
        skillReferences: cloneRuntimeSkillReferences(input.skillReferences),
        attachments: input.attachments?.map((attachment) => ({ ...attachment })),
        createdAt,
        status: 'complete',
      };
      const goal: RuntimeThreadGoal = {
        ...nextGoalState(
          threadId,
          undefined,
          { objective, status: 'active' },
          this.options.clock.now(),
        ),
        ...goalExecutionState(input, sourceMessage.id),
      };
      await this.publishGoal(goal, {
        queuedInputId: input.id,
        sourceMessage,
        turnId,
      });
      if (!thread.goal) await this.updateDefaultTitle(threadId, thread.title, goal.objective);
      const run = await this.options.createContinuation(
        threadId,
        goal,
        goalContinuationMessages(goal, this.options.ids, this.options.clock),
        { turnId },
      );
      void run.done.catch(() => undefined);
      return run;
    } finally {
      this.scheduling.delete(threadId);
    }
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
    const settlement = done.then(
      () => this.onTurnSettled(threadId, turnId, taskKind),
      () => this.onTurnSettled(threadId, turnId, taskKind),
    ).catch(() => undefined);
    const pending = this.pendingSettlements.get(threadId) ?? new Set<Promise<void>>();
    pending.add(settlement);
    this.pendingSettlements.set(threadId, pending);
    void settlement.finally(() => {
      pending.delete(settlement);
      if (!pending.size && this.pendingSettlements.get(threadId) === pending) this.pendingSettlements.delete(threadId);
    });
  }

  beginThreadDeletion(threadId: string): void {
    this.deletionPausedThreads.add(threadId);
  }

  async waitForThreadDeletionPause(threadId: string): Promise<void> {
    for (;;) {
      const pending = [...(this.pendingSettlements.get(threadId) ?? [])];
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  finishThreadDeletion(threadId: string, deleted: boolean): void {
    this.deletionPausedThreads.delete(threadId);
    if (deleted) {
      this.noProgressTurns.delete(threadId);
      this.pendingSettlements.delete(threadId);
      return;
    }
    void this.continueIfIdle(threadId).catch(() => undefined);
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
    if (this.stopped || this.deletionPausedThreads.has(threadId) || this.scheduling.has(threadId) || this.options.activeTask(threadId)) return;
    this.scheduling.add(threadId);
    try {
      const thread = await this.requireThread(threadId);
      const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
      if (this.deletionPausedThreads.has(threadId) || !goal || goal.status !== 'active' || this.options.activeTask(threadId)) return;
      // 用户明确排队的下一轮优先于后台目标续轮，避免两个调度器同时争抢线程空闲位。
      if (await this.options.hasQueuedInput?.(threadId)) return;
      // Plan 必须先由用户确认或放弃。等待期间不能让后台 Goal 抢占线程，否则计划
      // 决策会被任务注册表拒绝，并且 Goal 会在用户确认前继续执行。
      if (hasAwaitingPlanConfirmation(thread.messages)) return;
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
    if (this.deletionPausedThreads.has(threadId)) return;
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
    await this.publishGoal(updated, {
      preserveExecution: Boolean(updated.execution),
    });
    if (updated.status === 'active') await this.continueIfIdle(threadId);
  }

  private async updateStatus(goal: RuntimeThreadGoal, status: RuntimeThreadGoalStatus): Promise<void> {
    await this.publishGoal(
      { ...goal, status, updatedAt: epochSeconds(this.options.clock.now()) },
      { preserveExecution: Boolean(goal.execution) },
    );
  }

  private async publishGoal(
    goal: RuntimeThreadGoal,
    options: {
      preserveExecution?: boolean;
      queuedInputId?: string;
      sourceMessage?: RuntimeMessage;
      turnId?: string;
    } = {},
  ): Promise<void> {
    const snapshot = cloneRuntimeThreadGoal(goal);
    if (options.preserveExecution) delete snapshot.execution;
    await this.options.appendEvent(goal.threadId, {
      id: this.options.ids.id('event'),
      threadId: goal.threadId,
      turnId: options.turnId,
      type: 'thread.goal_updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        goal: snapshot,
        ...(options.preserveExecution ? { preserveExecution: true } : {}),
        ...(options.queuedInputId ? { queuedInputId: options.queuedInputId } : {}),
        ...(options.sourceMessage ? { sourceMessage: options.sourceMessage } : {}),
      },
    });
  }

  private async updateDefaultTitle(
    threadId: string,
    currentTitle: string,
    objective: string,
  ): Promise<void> {
    if (currentTitle !== DEFAULT_THREAD_TITLE) return;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'thread.updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: { title: fallbackThreadTitle(objective) },
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

function nextGoalState(
  threadId: string,
  previous: RuntimeThreadGoal | undefined,
  patch: RuntimeThreadGoalPatch,
  nowDate: Date,
): RuntimeThreadGoal {
  const objective = patch.objective === undefined ? previous?.objective : normalizeObjective(patch.objective);
  if (!objective) throw new Error(`cannot update goal for thread ${threadId}: no goal exists`);
  const status = normalizeGoalStatus(patch.status ?? previous?.status ?? 'active');
  const tokenBudget = patch.tokenBudget === undefined
    ? previous?.tokenBudget ?? null
    : normalizeTokenBudget(patch.tokenBudget);
  const now = epochSeconds(nowDate);
  const replacesTerminalGoal = Boolean(
    previous
    && previous.objective !== objective
    && isTerminalGoalStatus(previous.status),
  );
  return {
    threadId,
    objective,
    status,
    tokenBudget,
    tokensUsed: replacesTerminalGoal ? 0 : previous?.tokensUsed ?? 0,
    timeUsedSeconds: replacesTerminalGoal ? 0 : previous?.timeUsedSeconds ?? 0,
    createdAt: replacesTerminalGoal ? now : previous?.createdAt ?? now,
    updatedAt: now,
    execution: replacesTerminalGoal
      ? undefined
      : previous?.execution
        ? cloneRuntimeThreadGoal(previous).execution
        : undefined,
  };
}

function goalExecutionState(
  input: RuntimeQueuedTurnInput,
  sourceMessageId: string,
): Pick<RuntimeThreadGoal, 'execution'> {
  const execution: RuntimeThreadGoalExecutionOptions = {
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
    sourceMessageId,
    skillIds: input.skillIds ? [...input.skillIds] : undefined,
    skillReferences: cloneRuntimeSkillReferences(input.skillReferences),
    thinking: input.thinking === true,
    thinkingEffort: input.thinking === true ? input.thinkingEffort : undefined,
  };
  return { execution };
}

function assertNoUnfinishedGoal(goal: RuntimeThreadGoal | undefined): void {
  if (goal && !isTerminalGoalStatus(goal.status)) {
    throw new Error('An unfinished goal already exists. Finish or clear it before starting another goal.');
  }
}

function hasAwaitingPlanConfirmation(messages: RuntimeMessage[]): boolean {
  return messages.some((message) => (
    message.role === 'assistant'
    && message.planMode?.mode === 'plan'
    && message.planMode.status === 'awaiting_confirmation'
  ));
}

function isTerminalGoalStatus(status: RuntimeThreadGoalStatus): boolean {
  return status === 'complete' || status === 'blocked' || status === 'budgetLimited' || status === 'usageLimited';
}

function goalToolResult(name: string, data: Record<string, unknown>, preview: string): GoalToolExecutionResult {
  return { content: JSON.stringify({ tool: name, ...data }), data, preview };
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}
