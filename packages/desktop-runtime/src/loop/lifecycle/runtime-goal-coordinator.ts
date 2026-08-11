import {
  cloneRuntimeSkillReferences,
  cloneRuntimeThreadGoal,
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeEvent,
  type RuntimeGoalExitKind,
  type RuntimeMessage,
  type RuntimeQueuedTurnInput,
  type RuntimeTaskKind,
  type RuntimeThreadGoal,
  type RuntimeThreadGoalPatch,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { recordInput } from '../../shared/unknown.js';
import { goalExitMessage } from './runtime-goal-prompts.js';
import {
  accountGoalTurn,
  epochSeconds,
  goalExecutionState,
  isProviderUsageLimit,
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

type GoalContinuationOptions = { turnId?: string };

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
  registeredTask(threadId: string): ActiveGoalTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  createContinuation(
    threadId: string,
    goal: RuntimeThreadGoal,
    options?: GoalContinuationOptions,
  ): Promise<GoalContinuationRun>;
  hasQueuedInput?(threadId: string): Promise<boolean>;
  waitForCancellationWrites(threadId: string): Promise<void>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

type SetGoalOptions = {
  cancelActiveGoalTurn?: boolean;
  execution?: RuntimeThreadGoal['execution'];
  forceNew?: boolean;
};

/** 管理持久化目标状态、计量、模型工具、恢复安全和空闲轮次续接。 */
export class RuntimeGoalCoordinator {
  private readonly scheduling = new Set<string>();
  private readonly deletionPausedThreads = new Set<string>();
  private readonly pendingSettlements = new Map<string, Set<Promise<void>>>();
  private readonly observedRuns = new WeakSet<object>();
  private readonly goalIdByTurnId = new Map<string, string>();
  private readonly goalObjectiveByTurnId = new Map<string, string>();
  private readonly pendingCompletionGoalIdByTurnId = new Map<string, string>();
  private readonly retiredGoalIds = new Set<string>();
  private readonly supersededGoalTurnIds = new Set<string>();
  private readonly suppressCancellationPauseThreads = new Set<string>();
  private readonly mutationTails = new Map<string, Promise<void>>();
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

  /** Completion is committed only after this turn reaches a successful terminal event. */
  isCompletionPending(turnId: string, goalId: string): boolean {
    return this.pendingCompletionGoalIdByTurnId.get(turnId) === goalId;
  }

  /** Runtime restart never silently resumes an autonomous goal. */
  async reconcileRestoredGoals(): Promise<void> {
    const summaries = await this.options.threadStore.listThreads({ includeArchived: true });
    for (const summary of summaries) {
      await this.withGoalMutation(summary.id, async () => {
        const thread = await this.options.threadStore.getThread(summary.id);
        if (!thread?.goal) return;
        const normalized = normalizeRestoredGoal(thread.goal, this.options.ids);
        const accounted = await this.accountUnsettledGoalTurns(summary.id, normalized);
        const now = this.options.clock.now();
        const restored = normalized.status === 'active'
          ? withGoalStatus(accounted, 'paused', now, {
              code: 'runtimeReloaded',
              message: 'Goal paused because the runtime restarted.',
            })
          : sameGoalState(normalized, accounted)
            ? accounted
            : { ...accounted, updatedAt: epochSeconds(now) };
        if (sameGoalState(thread.goal, restored)) return;
        await this.publishGoal(restored, { preserveExecution: Boolean(restored.execution) });
      });
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
    return this.withGoalMutation(
      threadId,
      () => this.setGoalUnlocked(threadId, patch, options),
    );
  }

  private async setGoalUnlocked(
    threadId: string,
    patch: RuntimeThreadGoalPatch,
    options: SetGoalOptions,
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
    const nextGoal = nextGoalState(
      threadId,
      previous,
      patch,
      this.options.clock.now(),
      this.options.ids,
      options.forceNew === true,
    );
    const goal = options.execution
      ? cloneRuntimeThreadGoal({ ...nextGoal, execution: options.execution })
      : nextGoal;
    if (previous && previous.id === goal.id && previous.status !== 'active' && goal.status === 'active') {
      this.supersedePendingGoalTurns(goal.id);
    }
    const active = this.options.activeTask(threadId);
    const replacingActiveGoal = Boolean(
      previous
      && previous.id !== goal.id
      && active
      && this.taskBelongsToGoal(active, previous.id),
    );
    if (replacingActiveGoal && options.cancelActiveGoalTurn !== false && active) {
      this.retiredGoalIds.add(previous!.id);
      await this.cancelGoalTurnWithoutPausing(threadId, active.turnId);
    }

    await this.publishGoal(goal, {
      preserveExecution: Boolean(
        previous?.id === goal.id
        && previous.execution
        && goal.execution
      ),
    });
    if (!previous) await this.updateDefaultTitle(threadId, thread.title, goal.objective);

    const currentActive = this.options.activeTask(threadId);
    if (
      goal.status !== 'active'
      && options.cancelActiveGoalTurn !== false
      && currentActive
      && this.taskBelongsToGoal(currentActive, goal.id)
    ) {
      await this.cancelGoalTurnWithoutPausing(threadId, currentActive.turnId);
    }
    if (goal.status === 'active') await this.continueIfIdle(threadId);
    return goal;
  }

  /** 将队列 Goal 原子转换为状态、可见用户消息和首轮执行。 */
  async startQueuedGoal(
    threadId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<GoalContinuationRun> {
    return this.withGoalMutation(
      threadId,
      () => this.startQueuedGoalUnlocked(threadId, input),
    );
  }

  private async startQueuedGoalUnlocked(
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
      if (!thread.goal) await this.updateDefaultTitle(threadId, thread.title, goal.objective);
      const run = await this.options.createContinuation(
        threadId,
        goal,
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
    return this.withGoalMutation(threadId, () => this.clearGoalUnlocked(threadId));
  }

  private async clearGoalUnlocked(threadId: string): Promise<void> {
    const thread = await this.requireThread(threadId);
    const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
    if (!goal) return;
    const task = this.options.registeredTask(threadId) ?? this.options.activeTask(threadId);
    const goalTask = task && this.taskBelongsToGoal(task, goal.id) ? task : null;
    const retiredGoalTurn = Boolean(goalTask);
    try {
      if (goalTask) {
        // The cancelled turn may settle after goal_cleared; retire its ID before aborting so a
        // late accounting write cannot resurrect the cleared Goal.
        this.retiredGoalIds.add(goal.id);
        await this.cancelGoalTurnWithoutPausing(threadId, goalTask.turnId);
      }
      await this.options.waitForCancellationWrites(threadId);
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        type: 'thread.goal_cleared',
        createdAt: this.options.clock.now().toISOString(),
        payload: { cleared: true },
      });
    } catch (error) {
      // If the atomic clear fails, allow the cancelled turn to settle and pause the still-active Goal.
      if (retiredGoalTurn) this.retiredGoalIds.delete(goal.id);
      throw error;
    }
  }

  async resumeGoal(threadId: string): Promise<void> {
    return this.withGoalMutation(threadId, async () => {
      const thread = await this.requireThread(threadId);
      const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
      if (!goal) return;
      if (goal.status === 'active') {
        await this.continueIfIdle(threadId);
        return;
      }
      if (goal.status === 'complete') throw new Error('A completed goal cannot be resumed. Create a new goal instead.');
      await this.setGoalUnlocked(threadId, { status: 'active' }, {});
    });
  }

  async pauseForCancellation(threadId: string): Promise<void> {
    if (this.suppressCancellationPauseThreads.has(threadId)) return;
    await this.withGoalMutation(threadId, async () => {
      if (this.suppressCancellationPauseThreads.has(threadId)) return;
      const thread = await this.requireThread(threadId);
      const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
      if (goal?.status === 'active') {
        const updated = withGoalStatus(goal, 'paused', this.options.clock.now(), {
          code: 'turnCancelled',
          message: 'Goal paused because its active turn was cancelled.',
        });
        await this.publishGoal(updated, { preserveExecution: Boolean(goal.execution) });
      }
    });
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
      this.pendingCompletionGoalIdByTurnId.delete(turnId);
      this.supersededGoalTurnIds.delete(turnId);
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

  /** Waits for post-turn Goal accounting after the underlying turn tasks have drained. */
  async waitForSettlements(): Promise<void> {
    for (;;) {
      const pending = [...this.pendingSettlements.values()].flatMap((settlements) => [...settlements]);
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
      const objective = normalizeGoalObjective(input.objective);
      return this.withGoalMutation(context.threadId, async () => {
        const thread = await this.requireThread(context.threadId);
        const currentGoal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
        this.assertCurrentGoalRevision(context.turnId, currentGoal);
        const boundToCurrentGoal = Boolean(
          currentGoal
          && this.goalIdByTurnId.get(context.turnId) === currentGoal.id
        );
        const goal = await this.setGoalUnlocked(
          context.threadId,
          { objective, status: 'active' },
          {
            cancelActiveGoalTurn: false,
            execution: boundToCurrentGoal ? currentGoal?.execution : context.goalExecution,
            forceNew: true,
          },
        );
        this.goalIdByTurnId.set(context.turnId, goal.id);
        this.goalObjectiveByTurnId.set(context.turnId, goal.objective);
        return goalToolResult(name, { goal }, 'Goal created.');
      });
    }
    if (name === 'update_goal') {
      normalizeCompletionStatus(input.status);
      return this.withGoalMutation(context.threadId, async () => {
        const thread = await this.requireThread(context.threadId);
        const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
        if (!goal || goal.status !== 'active') throw new Error('No active goal is available to complete.');
        this.assertCurrentGoalRevision(context.turnId, goal);
        // The provider must still consume this tool result and finish the turn. Keep the durable
        // Goal active until that succeeds so a cancellation, runtime error, or restart cannot be
        // mistaken for verified completion.
        this.goalIdByTurnId.set(context.turnId, goal.id);
        this.goalObjectiveByTurnId.set(context.turnId, goal.objective);
        this.pendingCompletionGoalIdByTurnId.set(context.turnId, goal.id);
        return goalToolResult(
          name,
          { goal, completionPending: true },
          'Goal completion will be finalized when this turn completes successfully.',
        );
      });
    }
    throw new Error(`Unknown goal tool: ${name}`);
  }

  /** Recovers terminal turns that are newer than the Goal's explicit accounting watermark. */
  private async accountUnsettledGoalTurns(
    threadId: string,
    goal: RuntimeThreadGoal,
  ): Promise<RuntimeThreadGoal> {
    const events = await this.options.threadStore.listEvents(threadId);
    const goalUpdates = events.filter((event) => event.type === 'thread.goal_updated');
    const identityCheckpoint = [...goalUpdates].reverse().find((event) => event.payload.goal.id === goal.id)
      ?? goalUpdates.at(-1);
    if (!identityCheckpoint) return goal;
    // Older snapshots keep their latest-snapshot baseline once; later writes persist this watermark.
    const persistedAccountingSeq = goal.accountedThroughSeq;
    const accountedThroughSeq = typeof persistedAccountingSeq === 'number'
      && Number.isInteger(persistedAccountingSeq)
      && persistedAccountingSeq >= 0
      ? persistedAccountingSeq
      : identityCheckpoint.seq;
    const terminalEvents = events.filter((event) => (
      event.seq > accountedThroughSeq
      && event.turnId
      && (event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error')
    ));
    const terminalTurnIds = [...new Set(terminalEvents.flatMap((event) => event.turnId ? [event.turnId] : []))];
    const accounted = terminalTurnIds.reduce((current, turnId) => {
      const turnEvents = events.filter((event) => event.turnId === turnId);
      return restoredTurnBelongsToGoal(events, turnEvents, identityCheckpoint.payload.goal)
        ? accountGoalTurn(current, turnEvents, this.options.clock.now())
        : current;
    }, goal);
    return {
      ...accounted,
      accountedThroughSeq: Math.max(
        accountedThroughSeq,
        ...terminalEvents.map((event) => event.seq),
      ),
    };
  }

  private async continueIfIdle(threadId: string): Promise<void> {
    if (
      this.stopped
      || this.deletionPausedThreads.has(threadId)
      || this.scheduling.has(threadId)
      || this.options.activeTask(threadId)
      || this.options.registeredTask(threadId)
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
        || this.options.registeredTask(threadId)
      ) return;
      // Explicit user work always beats autonomous continuation.
      if (await this.options.hasQueuedInput?.(threadId)) return;
      const run = await this.options.createContinuation(threadId, goal);
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
    // A regular turn can create a Goal through create_goal. Once that turn is bound to the new
    // Goal, its final usage and outcome belong to the Goal just like a runtime-created Goal turn.
    if (taskKind !== 'goal' && !observedGoalId) {
      await this.withGoalMutation(threadId, async () => {
        if (this.deletionPausedThreads.has(threadId)) return;
        const goal = (await this.requireThread(threadId)).goal;
        if (goal?.status === 'active') await this.continueIfIdle(threadId);
      });
      return;
    }

    const events = (await this.options.threadStore.listEvents(threadId))
      .filter((event) => event.turnId === turnId);
    await this.withGoalMutation(threadId, () => this.settleGoalTurn(
      threadId,
      turnId,
      observedGoalId,
      observedGoalObjective,
      events,
    ));
  }

  private async settleGoalTurn(
    threadId: string,
    turnId: string,
    observedGoalId: string | undefined,
    observedGoalObjective: string | undefined,
    events: Awaited<ReturnType<ThreadStore['listEvents']>>,
  ): Promise<void> {
    if (this.deletionPausedThreads.has(threadId)) return;
    if (observedGoalId && this.retiredGoalIds.has(observedGoalId)) return;
    // Re-read only after the awaited event lookup and inside the per-thread Goal mutation queue.
    // This prevents a stale settlement from overwriting an edit, replacement, or clear.
    const thread = await this.requireThread(threadId);
    const goal = thread.goal ? cloneRuntimeThreadGoal(thread.goal) : null;
    if (!goal) return;
    if (observedGoalId && observedGoalId !== goal.id) return;

    const accounted = accountGoalTurn(goal, events, this.options.clock.now());
    if (this.supersededGoalTurnIds.has(turnId)) {
      // A user resumed this Goal while the cancelled turn was still settling. Keep the explicit
      // active state, account only the old turn, then launch the deferred continuation.
      await this.publishGoal({
        ...accounted,
        updatedAt: epochSeconds(this.options.clock.now()),
      }, { preserveExecution: Boolean(accounted.execution) });
      if (accounted.status === 'active') await this.continueIfIdle(threadId);
      return;
    }
    if (observedGoalObjective && observedGoalObjective !== goal.objective) {
      // An edit keeps Goal identity but changes the work contract. Preserve time/usage from the
      // already-running turn without letting its stale result complete, block, or score the edit.
      const updated = {
        ...accounted,
        updatedAt: epochSeconds(this.options.clock.now()),
      };
      await this.publishGoal(updated, {
        preserveExecution: Boolean(updated.execution),
      });
      if (accounted.status === 'active') await this.continueIfIdle(threadId);
      return;
    }
    let nextStatus = accounted.status;
    let stopReason = accounted.stopReason;
    const completionRequested = this.pendingCompletionGoalIdByTurnId.get(turnId) === goal.id;
    const terminalEvent = [...events].reverse().find((event) => (
      event.type === 'turn.completed'
      || event.type === 'turn.cancelled'
      || event.type === 'runtime.error'
    ));

    if (nextStatus === 'active' && terminalEvent?.type === 'turn.cancelled') {
      nextStatus = 'paused';
      stopReason = {
        code: 'turnCancelled',
        message: 'Goal paused because its active turn was cancelled.',
      };
    }
    if (nextStatus === 'active' && terminalEvent?.type === 'runtime.error') {
      const usageLimited = isProviderUsageLimit(terminalEvent.payload.message);
      nextStatus = usageLimited ? 'usageLimited' : 'blocked';
      stopReason = {
        code: usageLimited ? 'usageLimited' : 'runtimeError',
        message: terminalEvent.payload.message,
      };
    }
    if (nextStatus === 'active' && completionRequested && terminalEvent?.type === 'turn.completed') {
      nextStatus = 'complete';
      stopReason = undefined;
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
    const exitKind = updated.status !== goal.status
      ? goalExitKindForStatus(updated.status)
      : null;
    // The exit summary shares the final accounted event so its usage is exact, including this turn.
    await this.publishGoal(updated, {
      preserveExecution: Boolean(updated.execution),
      lifecycleMessage: exitKind
        ? goalExitMessage(updated, exitKind, this.options.ids, this.options.clock, turnId)
        : undefined,
    });
    if (updated.status === 'active') {
      await this.continueIfIdle(threadId);
    }
  }

  private async publishGoal(
    goal: RuntimeThreadGoal,
    options: {
      lifecycleMessage?: RuntimeMessage;
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
        ...(options.lifecycleMessage ? { lifecycleMessage: options.lifecycleMessage } : {}),
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

  private async cancelGoalTurnWithoutPausing(threadId: string, turnId: string): Promise<boolean> {
    this.suppressCancellationPauseThreads.add(threadId);
    try {
      return await this.options.cancelTurn(threadId, turnId);
    } finally {
      this.suppressCancellationPauseThreads.delete(threadId);
    }
  }

  /** Serializes read-modify-append Goal transactions so late turn settlement cannot win a race. */
  private withGoalMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(threadId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.mutationTails.set(threadId, tail);
    return result.finally(() => {
      if (this.mutationTails.get(threadId) === tail) this.mutationTails.delete(threadId);
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

  private supersedePendingGoalTurns(goalId: string): void {
    for (const [turnId, boundGoalId] of this.goalIdByTurnId) {
      if (boundGoalId === goalId) this.supersededGoalTurnIds.add(turnId);
    }
  }

  private taskBelongsToGoal(task: ActiveGoalTask, goalId: string): boolean {
    const boundGoalId = this.goalIdByTurnId.get(task.turnId);
    return boundGoalId ? boundGoalId === goalId : task.taskKind === 'goal';
  }
}

function goalExitKindForStatus(status: RuntimeThreadGoal['status']): RuntimeGoalExitKind | null {
  return status === 'complete' || status === 'blocked' || status === 'usageLimited'
    ? status
    : null;
}

function restoredTurnBelongsToGoal(
  allEvents: RuntimeEvent[],
  turnEvents: RuntimeEvent[],
  goal: RuntimeThreadGoal,
): boolean {
  const lifecycleEvent = [...turnEvents].reverse().find((event) => (
    event.type === 'message.created'
    && event.payload.message.goalMode
  ));
  let owner = lifecycleEvent?.type === 'message.created'
    ? lifecycleEvent.payload.message.goalMode?.goal
    : undefined;
  if (!owner) {
    const started = turnEvents.find((event) => event.type === 'turn.started');
    if (started?.type !== 'turn.started' || started.payload.taskKind !== 'goal') return false;
    const precedingGoalUpdate = [...allEvents].reverse().find((event) => (
      event.seq < started.seq
      && event.type === 'thread.goal_updated'
    ));
    owner = precedingGoalUpdate?.type === 'thread.goal_updated'
      ? precedingGoalUpdate.payload.goal
      : undefined;
  }
  if (!owner) return false;
  const ownerId = (owner as RuntimeThreadGoal & { id?: unknown }).id;
  const currentId = (goal as RuntimeThreadGoal & { id?: unknown }).id;
  // Snapshots written before Goal identities existed can only be matched by their objective.
  return typeof currentId === 'string' && currentId.trim()
    ? ownerId === currentId
    : owner.objective === goal.objective;
}

function goalToolResult(
  name: string,
  data: Record<string, unknown>,
  preview: string,
): GoalToolExecutionResult {
  return { content: JSON.stringify({ tool: name, ...data }), data, preview };
}
