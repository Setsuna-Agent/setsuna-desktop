import {
  cloneRuntimeSkillReferences,
  cloneRuntimeThreadGoal,
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeGoalLifecycleKind,
  type RuntimeMessage,
  type RuntimeQueuedTurnInput,
  type RuntimeTaskKind,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalPatch,
  type RuntimeThreadGoalStatus,
  type RuntimeThreadGoalStopReason,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { recordInput } from '../../shared/unknown.js';
import { goalContinuationContextMessages, goalLifecycleMessage } from './runtime-goal-prompts.js';
import {
  accountGoalTurn,
  epochSeconds,
  goalExecutionState,
  goalLifecycleTransition,
  hasAwaitingPlanConfirmation,
  isProviderUsageLimit,
  lifecycleKindForStatus,
  MAX_AUTOMATIC_GOAL_TURNS,
  MAX_CONSECUTIVE_NO_PROGRESS_TURNS,
  nextGoalSafety,
  nextGoalState,
  normalizeCompletionStatus,
  normalizeGoalObjective,
  normalizeRestoredGoal,
  sameGoalState,
  withGoalStatus,
} from './runtime-goal-state.js';

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
  publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void>;
};

type SetGoalOptions = {
  cancelActiveGoalTurn?: boolean;
  forceNew?: boolean;
  lifecycleTurnId?: string;
};

/** 管理持久化目标状态、计量、模型工具、恢复安全和空闲轮次续接。 */
export class RuntimeGoalCoordinator {
  private readonly scheduling = new Set<string>();
  private readonly deletionPausedThreads = new Set<string>();
  private readonly pendingSettlements = new Map<string, Set<Promise<void>>>();
  private readonly observedRuns = new WeakSet<object>();
  private readonly goalIdByTurnId = new Map<string, string>();
  private readonly goalObjectiveByTurnId = new Map<string, string>();
  private readonly retiredGoalIds = new Set<string>();
  private readonly suppressCancellationPauseThreads = new Set<string>();
  private stopped = false;

  constructor(private readonly options: RuntimeGoalCoordinatorOptions) {}

  shutdown(): void {
    this.stopped = true;
    this.scheduling.clear();
    this.goalIdByTurnId.clear();
    this.goalObjectiveByTurnId.clear();
    this.retiredGoalIds.clear();
  }

  async getGoal(threadId: string): Promise<RuntimeThreadGoal | null> {
    const thread = await this.requireThread(threadId);
    return thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
  }

  /** Runtime restart never silently resumes an autonomous goal. */
  async reconcileRestoredGoals(): Promise<void> {
    const summaries = await this.options.threadStore.listThreads({ includeArchived: true });
    for (const summary of summaries) {
      const thread = await this.options.threadStore.getThread(summary.id);
      if (!thread?.goal) continue;
      const normalized = normalizeRestoredGoal(thread.goal, this.options.ids);
      const restored = normalized.status === 'active'
        ? withGoalStatus(normalized, 'paused', this.options.clock.now(), {
            code: 'runtimeReloaded',
            message: 'Goal paused because the runtime restarted.',
          })
        : normalized;
      if (sameGoalState(thread.goal, restored)) continue;
      await this.publishGoal(restored, { preserveExecution: Boolean(restored.execution) });
      if (thread.goal.status === 'active') await this.publishLifecycle(restored, 'paused');
    }
  }

  /** 在队列事件落盘前复用 Goal 的领域校验。显式 Goal 输入允许替换当前目标。 */
  async validateQueuedGoal(threadId: string, objective: string): Promise<void> {
    normalizeGoalObjective(objective);
    await this.requireThread(threadId);
  }

  async setGoal(
    threadId: string,
    patch: RuntimeThreadGoalPatch,
    options: SetGoalOptions = {},
  ): Promise<RuntimeThreadGoal> {
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
    const goal = nextGoalState(
      threadId,
      previous,
      patch,
      this.options.clock.now(),
      this.options.ids,
      options.forceNew === true,
    );
    const active = this.options.activeTask(threadId);
    const replacingActiveGoal = Boolean(
      previous
      && previous.id !== goal.id
      && active?.taskKind === 'goal',
    );
    if (replacingActiveGoal && options.cancelActiveGoalTurn !== false && active) {
      this.retiredGoalIds.add(previous!.id);
      this.suppressCancellationPauseThreads.add(threadId);
      try {
        await this.options.cancelTurn(threadId, active.turnId);
      } finally {
        this.suppressCancellationPauseThreads.delete(threadId);
      }
    }

    await this.publishGoal(goal, {
      preserveExecution: Boolean(previous?.execution && goal.execution),
    });
    if (!previous) await this.updateDefaultTitle(threadId, thread.title, goal.objective);

    const lifecycleKind = goalLifecycleTransition(previous, goal);
    if (lifecycleKind) {
      await this.publishLifecycle(goal, lifecycleKind, options.lifecycleTurnId);
    }

    const currentActive = this.options.activeTask(threadId);
    if (
      goal.status !== 'active'
      && options.cancelActiveGoalTurn !== false
      && currentActive?.taskKind === 'goal'
    ) {
      await this.options.cancelTurn(threadId, currentActive.turnId);
    }
    if (goal.status === 'active') await this.continueIfIdle(threadId, false);
    return goal;
  }

  /** 将队列 Goal 原子转换为状态、可见用户消息和首轮执行。 */
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
      const objective = normalizeGoalObjective(input.input);
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
          thread.goal,
          {
            objective,
            status: 'active',
            tokenBudget: null,
          },
          this.options.clock.now(),
          this.options.ids,
          true,
        ),
        ...goalExecutionState(input, sourceMessage.id),
      };
      await this.publishGoal(goal, {
        queuedInputId: input.id,
        sourceMessage,
        turnId,
      });
      await this.publishLifecycle(goal, 'active', turnId);
      if (!thread.goal) await this.updateDefaultTitle(threadId, thread.title, goal.objective);
      const run = await this.options.createContinuation(
        threadId,
        goal,
        goalContinuationContextMessages(goal, this.options.ids, this.options.clock),
        { turnId },
      );
      this.observeRun(threadId, run.turnId, 'goal', run.done, goal.id, goal.objective);
      void run.done.catch(() => undefined);
      return run;
    } finally {
      this.scheduling.delete(threadId);
    }
  }

  async clearGoal(threadId: string): Promise<void> {
    const goal = await this.getGoal(threadId);
    if (!goal) return;
    const active = this.options.activeTask(threadId);
    if (active?.taskKind === 'goal') {
      // The cancelled turn may settle after goal_cleared; retire its ID before aborting so a
      // late accounting write cannot resurrect the cleared Goal.
      this.retiredGoalIds.add(goal.id);
      this.suppressCancellationPauseThreads.add(threadId);
      try {
        await this.options.cancelTurn(threadId, active.turnId);
      } finally {
        this.suppressCancellationPauseThreads.delete(threadId);
      }
    }
    await this.publishLifecycle(goal, 'cleared');
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'thread.goal_cleared',
      createdAt: this.options.clock.now().toISOString(),
      payload: { cleared: true },
    });
  }

  async resumeGoal(threadId: string): Promise<void> {
    const goal = await this.getGoal(threadId);
    if (!goal) return;
    if (goal.status === 'active') {
      await this.continueIfIdle(threadId);
      return;
    }
    if (goal.status === 'complete') throw new Error('A completed goal cannot be resumed. Create a new goal instead.');
    await this.setGoal(threadId, { status: 'active' });
  }

  async pauseForCancellation(threadId: string): Promise<void> {
    if (this.suppressCancellationPauseThreads.has(threadId)) return;
    const goal = await this.getGoal(threadId);
    if (goal?.status === 'active') {
      await this.updateStatus(goal, 'paused', {
        code: 'turnCancelled',
        message: 'Goal paused because its active turn was cancelled.',
      }, 'paused');
    }
  }

  observeRun(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    done: Promise<void>,
    goalId?: string,
    goalObjective?: string,
  ): void {
    if (this.observedRuns.has(done)) return;
    this.observedRuns.add(done);
    if (goalId) this.goalIdByTurnId.set(turnId, goalId);
    if (goalObjective) this.goalObjectiveByTurnId.set(turnId, goalObjective);
    const settlement = done.then(
      () => this.onTurnSettled(
        threadId,
        turnId,
        taskKind,
        this.goalIdByTurnId.get(turnId),
        this.goalObjectiveByTurnId.get(turnId),
      ),
      () => this.onTurnSettled(
        threadId,
        turnId,
        taskKind,
        this.goalIdByTurnId.get(turnId),
        this.goalObjectiveByTurnId.get(turnId),
      ),
    ).catch(() => undefined);
    const pending = this.pendingSettlements.get(threadId) ?? new Set<Promise<void>>();
    pending.add(settlement);
    this.pendingSettlements.set(threadId, pending);
    void settlement.finally(() => {
      const settledGoalId = this.goalIdByTurnId.get(turnId);
      this.goalIdByTurnId.delete(turnId);
      this.goalObjectiveByTurnId.delete(turnId);
      if (settledGoalId) this.retiredGoalIds.delete(settledGoalId);
      pending.delete(settlement);
      if (!pending.size && this.pendingSettlements.get(threadId) === pending) {
        this.pendingSettlements.delete(threadId);
      }
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
      this.pendingSettlements.delete(threadId);
      return;
    }
    void this.continueIfIdle(threadId).catch(() => undefined);
  }

  async execute(
    name: string,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
  ): Promise<GoalToolExecutionResult> {
    const input = recordInput(parsedArguments);
    if (name === 'get_goal') {
      const goal = await this.getGoal(context.threadId);
      return goalToolResult(name, { goal }, goal ? `Goal is ${goal.status}.` : 'No goal is set.');
    }
    if (name === 'create_goal') {
      const currentGoal = await this.getGoal(context.threadId);
      this.assertCurrentGoalRevision(context.turnId, currentGoal);
      const objective = normalizeGoalObjective(input.objective);
      const goal = await this.setGoal(
        context.threadId,
        { objective, status: 'active', tokenBudget: null },
        {
          cancelActiveGoalTurn: false,
          forceNew: true,
          lifecycleTurnId: context.turnId,
        },
      );
      if (context.turnId) {
        this.goalIdByTurnId.set(context.turnId, goal.id);
        this.goalObjectiveByTurnId.set(context.turnId, goal.objective);
      }
      return goalToolResult(name, { goal }, 'Goal created.');
    }
    if (name === 'update_goal') {
      normalizeCompletionStatus(input.status);
      const goal = await this.getGoal(context.threadId);
      if (!goal || goal.status !== 'active') throw new Error('No active goal is available to complete.');
      this.assertCurrentGoalRevision(context.turnId, goal);
      const completed = await this.setGoal(
        context.threadId,
        { status: 'complete' },
        { cancelActiveGoalTurn: false, lifecycleTurnId: context.turnId },
      );
      return goalToolResult(name, { goal: completed }, 'Goal marked complete.');
    }
    throw new Error(`Unknown goal tool: ${name}`);
  }

  private async continueIfIdle(threadId: string, publishContinuation = true): Promise<void> {
    if (
      this.stopped
      || this.deletionPausedThreads.has(threadId)
      || this.scheduling.has(threadId)
      || this.options.activeTask(threadId)
    ) return;
    this.scheduling.add(threadId);
    try {
      const thread = await this.requireThread(threadId);
      const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
      if (
        this.deletionPausedThreads.has(threadId)
        || !goal
        || goal.status !== 'active'
        || this.options.activeTask(threadId)
      ) return;
      // Explicit user work and unresolved Plan confirmation always beat autonomous continuation.
      if (await this.options.hasQueuedInput?.(threadId)) return;
      if (hasAwaitingPlanConfirmation(thread.messages)) return;
      if (publishContinuation) await this.publishLifecycle(goal, 'continuation');
      const run = await this.options.createContinuation(
        threadId,
        goal,
        goalContinuationContextMessages(goal, this.options.ids, this.options.clock),
      );
      this.observeRun(threadId, run.turnId, 'goal', run.done, goal.id, goal.objective);
      void run.done.catch(() => undefined);
    } finally {
      this.scheduling.delete(threadId);
    }
  }

  private async onTurnSettled(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    observedGoalId?: string,
    observedGoalObjective?: string,
  ): Promise<void> {
    if (this.deletionPausedThreads.has(threadId)) return;
    if (observedGoalId && this.retiredGoalIds.has(observedGoalId)) return;
    const goal = await this.getGoal(threadId);
    if (!goal) return;
    // A regular turn can create a Goal through create_goal. Once that turn is bound to the new
    // Goal, its final usage and outcome belong to the Goal just like a runtime-created Goal turn.
    if (taskKind !== 'goal' && !observedGoalId) {
      if (goal.status === 'active') await this.continueIfIdle(threadId);
      return;
    }
    if (observedGoalId && observedGoalId !== goal.id) return;

    const events = (await this.options.threadStore.listEvents(threadId))
      .filter((event) => event.turnId === turnId);
    const accounted = accountGoalTurn(goal, events, this.options.clock.now());
    if (observedGoalObjective && observedGoalObjective !== goal.objective) {
      // An edit keeps Goal identity but changes the work contract. Preserve time/usage from the
      // already-running turn without letting its stale result complete, block, or score the edit.
      await this.publishGoal({
        ...accounted,
        updatedAt: epochSeconds(this.options.clock.now()),
      }, { preserveExecution: Boolean(accounted.execution) });
      if (accounted.status === 'active') await this.continueIfIdle(threadId);
      return;
    }
    let nextStatus = accounted.status;
    let stopReason = accounted.stopReason;

    if (nextStatus === 'active' && events.some((event) => event.type === 'turn.cancelled')) {
      nextStatus = 'paused';
      stopReason = {
        code: 'turnCancelled',
        message: 'Goal paused because its active turn was cancelled.',
      };
    }
    const runtimeError = [...events].reverse().find((event) => event.type === 'runtime.error');
    if (nextStatus === 'active' && runtimeError?.type === 'runtime.error') {
      const usageLimited = isProviderUsageLimit(runtimeError.payload.message);
      nextStatus = usageLimited ? 'usageLimited' : 'blocked';
      stopReason = {
        code: usageLimited ? 'usageLimited' : 'runtimeError',
        message: runtimeError.payload.message,
      };
    }
    let safety = accounted.safety;
    if (nextStatus === 'active') {
      safety = nextGoalSafety(accounted.safety, events);
      if (safety.consecutiveNoProgressTurns >= MAX_CONSECUTIVE_NO_PROGRESS_TURNS) {
        nextStatus = 'blocked';
        stopReason = {
          code: 'noProgress',
          message: `Goal stopped after ${safety.consecutiveNoProgressTurns} consecutive turns without new evidence of progress.`,
        };
      } else if (safety.automaticTurns >= MAX_AUTOMATIC_GOAL_TURNS) {
        nextStatus = 'blocked';
        stopReason = {
          code: 'continuationLimit',
          message: `Goal stopped after ${safety.automaticTurns} automatic turns.`,
        };
      }
    }

    const updated: RuntimeThreadGoal = {
      ...accounted,
      status: nextStatus,
      stopReason: nextStatus === 'active' || nextStatus === 'complete' ? undefined : stopReason,
      safety,
      updatedAt: epochSeconds(this.options.clock.now()),
    };
    await this.publishGoal(updated, { preserveExecution: Boolean(updated.execution) });
    if (updated.status !== goal.status && updated.status !== 'active') {
      await this.publishLifecycle(updated, lifecycleKindForStatus(updated.status));
    }
    if (updated.status === 'active') {
      await this.continueIfIdle(threadId);
    }
  }

  private async updateStatus(
    goal: RuntimeThreadGoal,
    status: RuntimeThreadGoalStatus,
    stopReason?: RuntimeThreadGoalStopReason,
    lifecycleKind?: RuntimeGoalLifecycleKind,
  ): Promise<void> {
    const updated = withGoalStatus(goal, status, this.options.clock.now(), stopReason);
    await this.publishGoal(updated, { preserveExecution: Boolean(goal.execution) });
    if (lifecycleKind) await this.publishLifecycle(updated, lifecycleKind);
  }

  private async publishLifecycle(
    goal: RuntimeThreadGoal,
    kind: RuntimeGoalLifecycleKind,
    turnId?: string,
  ): Promise<void> {
    const message = goalLifecycleMessage(goal, kind, this.options.ids, this.options.clock, turnId);
    await this.options.publishMessage(goal.threadId, message.turnId!, message);
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

  private assertCurrentGoalRevision(
    turnId: string | undefined,
    goal: RuntimeThreadGoal | null,
  ): void {
    if (!turnId) return;
    const boundGoalId = this.goalIdByTurnId.get(turnId);
    if (boundGoalId && boundGoalId !== goal?.id) {
      throw new Error('This turn belongs to a replaced goal and cannot modify the current goal.');
    }
    const boundObjective = this.goalObjectiveByTurnId.get(turnId);
    if (boundObjective && boundObjective !== goal?.objective) {
      throw new Error('This turn belongs to an earlier goal revision and cannot modify the edited goal.');
    }
  }
}

function goalToolResult(
  name: string,
  data: Record<string, unknown>,
  preview: string,
): GoalToolExecutionResult {
  return { content: JSON.stringify({ tool: name, ...data }), data, preview };
}
