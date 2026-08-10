import type {
  QueueTurnInput,
  QueuedTurnInputEditRelease,
  QueuedTurnInputEditReleaseResponse,
  QueuedTurnInputEditSession,
  QueuedTurnInputPatch,
  QueuedTurnInputResponse,
  RuntimeMessage,
  RuntimeQueuedTurnInput,
  RuntimeTaskKind,
  SendTurnInput,
  SendTurnResponse,
} from '@setsuna-desktop/contracts';
import {
  cloneRuntimeSkillReferences,
  isRuntimeInputMessageAttachment,
  normalizeRuntimeQueuedTurnInputKind,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeModelInputGuard } from '../core/runtime-model-input-guard.js';
import { normalizeRuntimeSkillReferences } from '../core/runtime-skill-references.js';
import type { RuntimeTurnTask, RuntimeTurnTaskRegistry } from './turn-task-registry.js';

type QueuedTurnRun = {
  done: Promise<void>;
  turnId: string;
};

type QueuedTurnEditClaim = {
  editToken: string;
  inputId: string;
};

type RuntimeQueuedTurnCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  inputGuard: Pick<RuntimeModelInputGuard, 'assertAttachmentsSupported'>;
  threadStore: ThreadStore;
  turnTasks: Pick<RuntimeTurnTaskRegistry, 'activeForThread'>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  claimAttachments(
    threadId: string,
    attachments: NonNullable<RuntimeMessage['attachments']>,
  ): Promise<NonNullable<RuntimeMessage['attachments']>>;
  normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']>;
  validateGoalInput(threadId: string, objective: string): Promise<void>;
  startRegularTurn(
    threadId: string,
    input: SendTurnInput,
    queuedInputId: string,
  ): Promise<QueuedTurnRun>;
  startGoalTurn(
    threadId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<QueuedTurnRun>;
  steerQueuedInput(
    threadId: string,
    activeTurnId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<SendTurnResponse>;
  onRunCreated(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    done: Promise<void>,
  ): void;
};

const MAX_QUEUED_INPUTS_PER_THREAD = 20;

/**
 * 管理跨轮次的用户发送队列。
 *
 * 每个线程的写操作在这里串行化，避免自动续发、取回更新、立即发送和删除同时命中
 * 同一队列项。队列本体通过 RuntimeEvent 持久化；内存状态只负责调度互斥、编辑占用、
 * 最新轮次代次和失败暂停。
 */
export class RuntimeQueuedTurnCoordinator {
  private readonly dispatchingInputIds = new Set<string>();
  private readonly editingClaimsByThread = new Map<string, QueuedTurnEditClaim>();
  private readonly latestObservedRuns = new Map<string, Promise<unknown>>();
  private readonly observedRuns = new WeakSet<Promise<unknown>>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private readonly pausedThreads = new Set<string>();
  private stopped = false;

  constructor(private readonly options: RuntimeQueuedTurnCoordinatorOptions) {}

  shutdown(): void {
    this.stopped = true;
    this.editingClaimsByThread.clear();
    this.latestObservedRuns.clear();
    this.pausedThreads.clear();
  }

  async hasPending(threadId: string): Promise<boolean> {
    const thread = await this.options.threadStore.getThread(threadId);
    return Boolean(thread?.queuedTurnInputs?.length);
  }

  enqueue(threadId: string, input: QueueTurnInput): Promise<QueuedTurnInputResponse> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      const text = input.input.trim();
      const kind = normalizeRuntimeQueuedTurnInputKind(input.kind);
      let attachments = this.options.normalizeAttachments(input.attachments)
        .filter(isRuntimeInputMessageAttachment);
      assertQueuedInputContent(kind, text, attachments);

      const thread = await this.requireThread(threadId);
      if ((thread.queuedTurnInputs?.length ?? 0) >= MAX_QUEUED_INPUTS_PER_THREAD) {
        throw new Error(`A thread can queue at most ${MAX_QUEUED_INPUTS_PER_THREAD} inputs.`);
      }
      if (kind === 'goal') {
        assertNoOtherQueuedGoal(thread.queuedTurnInputs ?? []);
        await this.options.validateGoalInput(threadId, text);
      }

      await this.options.inputGuard.assertAttachmentsSupported(attachments);
      attachments = (await this.options.claimAttachments(threadId, attachments))
        .filter(isRuntimeInputMessageAttachment);
      const createdAt = this.options.clock.now().toISOString();
      const skillIds = normalizeSkillIds(input.skillIds);
      const queuedInput: RuntimeQueuedTurnInput = {
        id: this.options.ids.id('queued_input'),
        kind,
        input: text,
        clientId: input.clientId,
        attachments,
        skillIds,
        skillReferences: normalizeRuntimeSkillReferences({
          content: text,
          references: input.skillReferences,
          skillIds,
        }),
        thinking: input.thinking,
        thinkingEffort: normalizeThinkingEffort(input.thinking, input.thinkingEffort),
        createdAt,
      };
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        type: 'turn.input_queued',
        createdAt,
        payload: { input: queuedInput },
      });

      // 用户主动入队可以恢复此前因取消或失败而暂停的队列。
      this.pausedThreads.delete(threadId);
      const updated = await this.requireThread(threadId);
      const next = updated.queuedTurnInputs?.find((item) => !this.dispatchingInputIds.has(item.id));
      if (!next) return queuedResponse(queuedInput.id);
      const response = await this.dispatchInputIfIdle(threadId, next);
      // 恢复暂停队列时必须先发旧项；新入队项仍按自己的状态返回，避免把旧 turn
      // 错认成新项已经发送。
      return next.id === queuedInput.id ? response : queuedResponse(queuedInput.id);
    });
  }

  delete(threadId: string, inputId: string): Promise<boolean> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      const thread = await this.requireThread(threadId);
      const queuedInput = thread.queuedTurnInputs?.find((input) => input.id === inputId);
      if (!queuedInput) return false;
      this.assertNotDispatching(queuedInput.id);
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        type: 'turn.input_deleted',
        createdAt: this.options.clock.now().toISOString(),
        payload: { inputId: queuedInput.id },
      });
      if (this.editingClaimsByThread.get(threadId)?.inputId === inputId) {
        this.editingClaimsByThread.delete(threadId);
        await this.resumeAfterEditingClaimReleased(threadId);
      }
      return true;
    });
  }

  /**
   * 原子取回一个待发送项用于编辑。
   *
   * 取回期间队列项仍保留在事件投影中，只暂停自动调度；因此响应丢失、页面切换或
   * 应用退出都不会让消息消失。再次取回同一线程的其他项等价于放弃前一次编辑。
   */
  retrieveForEditing(threadId: string, inputId: string): Promise<QueuedTurnInputEditSession> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      const queuedInput = await this.requireQueuedInput(threadId, inputId);
      this.assertNotDispatching(queuedInput.id);
      const editToken = this.options.ids.id('queued_edit');
      this.editingClaimsByThread.set(threadId, {
        editToken,
        inputId: queuedInput.id,
      });
      return {
        editToken,
        input: cloneQueuedInput(queuedInput),
      };
    });
  }

  /**
   * 释放取回编辑并恢复队列调度。令牌不匹配时保持当前编辑不变，避免旧页面的迟到
   * cleanup 解锁后来开始的新编辑会话。
   */
  releaseEditing(
    threadId: string,
    inputId: string,
    input: QueuedTurnInputEditRelease,
  ): Promise<QueuedTurnInputEditReleaseResponse> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      if (!this.matchesEditingClaim(threadId, inputId, input.editToken)) {
        return { released: false, resumed: null };
      }

      this.editingClaimsByThread.delete(threadId);
      return {
        released: true,
        resumed: await this.resumeAfterEditingClaimReleased(threadId),
      };
    });
  }

  /**
   * 提交取回后的文本并恢复调度。更新事件和后续启动都处于同一线程串行区间内，
   * 即使客户端收不到响应，原队列项也只会保持更新后状态或已经开始发送。
   */
  updateAfterEditing(
    threadId: string,
    inputId: string,
    patch: QueuedTurnInputPatch,
  ): Promise<QueuedTurnInputResponse> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      const queuedInput = await this.requireQueuedInput(threadId, inputId);
      if (!this.matchesEditingClaim(threadId, queuedInput.id, patch.editToken)) {
        throw new Error(`Queued input is not being edited: ${inputId}`);
      }
      this.assertNotDispatching(queuedInput.id);
      const text = patch.input.trim();
      const kind = normalizeRuntimeQueuedTurnInputKind(queuedInput.kind);
      let attachments = queuedInput.attachments?.map((attachment) => ({ ...attachment })) ?? [];
      if (patch.attachments !== undefined) {
        attachments = this.options.normalizeAttachments(patch.attachments)
          .filter(isRuntimeInputMessageAttachment);
        await this.options.inputGuard.assertAttachmentsSupported(attachments);
      }
      assertQueuedInputContent(kind, text, attachments);
      if (kind === 'goal') {
        const thread = await this.requireThread(threadId);
        assertNoOtherQueuedGoal(thread.queuedTurnInputs ?? [], queuedInput.id);
        await this.options.validateGoalInput(threadId, text);
      }
      if (patch.attachments !== undefined) {
        attachments = (await this.options.claimAttachments(threadId, attachments))
          .filter(isRuntimeInputMessageAttachment);
      }
      const updatedAt = this.options.clock.now().toISOString();
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        type: 'turn.input_updated',
        createdAt: updatedAt,
        payload: {
          input: {
            ...cloneQueuedInput(queuedInput),
            input: text,
            attachments,
            skillReferences: undefined,
            updatedAt,
          },
        },
      });

      this.editingClaimsByThread.delete(threadId);
      // 编辑完成属于显式用户恢复动作，与重新入队和立即发送保持一致。
      this.pausedThreads.delete(threadId);
      const updatedThread = await this.requireThread(threadId);
      const next = updatedThread.queuedTurnInputs?.find(
        (item) => !this.dispatchingInputIds.has(item.id),
      );
      if (!next) return queuedResponse(queuedInput.id);
      const response = await this.dispatchInputIfIdle(threadId, next);
      // 编辑不会改变原有 FIFO 位置；若更早的项先启动，当前编辑项仍应报告 queued。
      return next.id === queuedInput.id ? response : queuedResponse(queuedInput.id);
    });
  }

  sendNow(threadId: string, inputId: string): Promise<QueuedTurnInputResponse> {
    return this.runExclusive(threadId, async () => {
      this.assertRunning();
      if (this.editingClaimsByThread.has(threadId)) {
        throw new Error('A queued input is currently being edited.');
      }
      const queuedInput = await this.requireQueuedInput(threadId, inputId);
      this.assertNotDispatching(queuedInput.id);

      const active = this.options.turnTasks.activeForThread(threadId);
      const kind = normalizeRuntimeQueuedTurnInputKind(queuedInput.kind);
      if (active && kind !== 'message') {
        throw new Error(`Queued ${kind} input must wait for the active turn to finish.`);
      }
      if (active && !canSteer(active)) {
        throw new Error(`Active ${active.taskKind} turn cannot receive queued input now.`);
      }
      this.pausedThreads.delete(threadId);
      if (active) {
        try {
          const response = await this.options.steerQueuedInput(
            threadId,
            active.turnId,
            queuedInput,
          );
          return {
            accepted: true,
            disposition: 'steered',
            queuedInputId: queuedInput.id,
            turnId: response.turnId,
          };
        } catch (error) {
          if (!isExpiredSteerError(error)) throw error;
          // turn 可能恰好在点击期间完成；重新检查后按独立轮次发送，保证不丢不重。
        }
      }

      return this.dispatchInputIfIdle(threadId, queuedInput);
    });
  }

  observeRun(
    threadId: string,
    turnId: string,
    _taskKind: RuntimeTaskKind,
    done: Promise<unknown>,
  ): void {
    if (this.observedRuns.has(done)) return;
    this.observedRuns.add(done);
    this.latestObservedRuns.set(threadId, done);
    void done.then(
      () => this.onTurnSettled(threadId, turnId, done),
      () => this.onTurnSettled(threadId, turnId, done),
    ).catch(() => undefined);
  }

  private onTurnSettled(
    threadId: string,
    turnId: string,
    settledRun: Promise<unknown>,
  ): Promise<void> {
    return this.runExclusive(threadId, async () => {
      try {
        if (this.stopped || !this.isLatestObservedRun(threadId, settledRun)) return;
        const events = await this.options.threadStore.listEvents(threadId);
        if (!this.isLatestObservedRun(threadId, settledRun)) return;
        const outcome = terminalOutcome(events, turnId);
        if (outcome !== 'completed') {
          const hasPending = await this.hasPending(threadId);
          if (hasPending && this.isLatestObservedRun(threadId, settledRun)) {
            this.pausedThreads.add(threadId);
          }
          return;
        }
        if (this.isDispatchPaused(threadId)) return;
        const thread = await this.requireThread(threadId);
        if (!this.isLatestObservedRun(threadId, settledRun)) return;
        const next = thread.queuedTurnInputs?.find((input) => !this.dispatchingInputIds.has(input.id));
        if (next) await this.dispatchInputIfIdle(threadId, next);
      } finally {
        if (this.latestObservedRuns.get(threadId) === settledRun) {
          this.latestObservedRuns.delete(threadId);
        }
      }
    });
  }

  private async dispatchInputIfIdle(
    threadId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<QueuedTurnInputResponse> {
    if (this.isDispatchPaused(threadId)) {
      return queuedResponse(input.id);
    }
    if (this.options.turnTasks.activeForThread(threadId)) {
      return queuedResponse(input.id);
    }

    this.dispatchingInputIds.add(input.id);
    try {
      const kind = normalizeRuntimeQueuedTurnInputKind(input.kind);
      const taskKind: RuntimeTaskKind = kind === 'goal' ? 'goal' : 'regular';
      const run = kind === 'goal'
        ? await this.options.startGoalTurn(threadId, cloneQueuedInput(input))
        : await this.options.startRegularTurn(
            threadId,
            queuedInputAsTurnInput(input),
            input.id,
          );
      this.observeRun(threadId, run.turnId, taskKind, run.done);
      this.options.onRunCreated(threadId, run.turnId, taskKind, run.done);
      void run.done.finally(() => this.dispatchingInputIds.delete(input.id)).catch(() => undefined);
      return {
        accepted: true,
        disposition: 'started',
        queuedInputId: input.id,
        turnId: run.turnId,
      };
    } catch (error) {
      this.dispatchingInputIds.delete(input.id);
      // 另一个入口抢先启动了 turn 时，队列项保持原状并等待下一次正常收尾。
      if (this.options.turnTasks.activeForThread(threadId)) return queuedResponse(input.id);
      throw error;
    }
  }

  private async requireThread(threadId: string) {
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private async requireQueuedInput(
    threadId: string,
    inputId: string,
  ): Promise<RuntimeQueuedTurnInput> {
    const thread = await this.requireThread(threadId);
    const queuedInput = thread.queuedTurnInputs?.find((input) => input.id === inputId);
    if (!queuedInput) throw new Error(`Queued input not found: ${inputId}`);
    return cloneQueuedInput(queuedInput);
  }

  /**
   * 所有解除编辑占用的路径都从这里恢复队首，避免 delete/release 的行为逐渐分叉。
   */
  private async resumeAfterEditingClaimReleased(
    threadId: string,
  ): Promise<QueuedTurnInputResponse | null> {
    if (this.pausedThreads.has(threadId)) return null;
    const thread = await this.requireThread(threadId);
    const next = thread.queuedTurnInputs?.find(
      (item) => !this.dispatchingInputIds.has(item.id),
    );
    return next ? this.dispatchInputIfIdle(threadId, next) : null;
  }

  private assertNotDispatching(inputId: string): void {
    if (this.dispatchingInputIds.has(inputId)) {
      throw new Error('Queued input is already being sent.');
    }
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error('Desktop runtime is shutting down.');
  }

  private isDispatchPaused(threadId: string): boolean {
    return this.pausedThreads.has(threadId) || this.editingClaimsByThread.has(threadId);
  }

  private matchesEditingClaim(threadId: string, inputId: string, editToken: string): boolean {
    const claim = this.editingClaimsByThread.get(threadId);
    return Boolean(
      editToken
      && claim?.inputId === inputId
      && claim.editToken === editToken,
    );
  }

  private isLatestObservedRun(threadId: string, run: Promise<unknown>): boolean {
    return this.latestObservedRuns.get(threadId) === run;
  }

  private runExclusive<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(threadId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.operationTails.set(threadId, tail);
    void tail.finally(() => {
      if (this.operationTails.get(threadId) === tail) this.operationTails.delete(threadId);
    });
    return result;
  }
}

function terminalOutcome(
  events: Awaited<ReturnType<ThreadStore['listEvents']>>,
  turnId: string,
): 'completed' | 'interrupted' | 'missing' {
  let completed = false;
  for (const event of events) {
    if (event.turnId !== turnId) continue;
    if (event.type === 'turn.cancelled' || event.type === 'runtime.error') return 'interrupted';
    if (event.type === 'turn.completed') completed = true;
  }
  return completed ? 'completed' : 'missing';
}

function canSteer(task: RuntimeTurnTask | null): boolean {
  return Boolean(
    task
    && (task.taskKind === 'regular' || task.taskKind === 'goal')
    && task.acceptingSteers
    && !task.controller.signal.aborted,
  );
}

function queuedInputAsTurnInput(input: RuntimeQueuedTurnInput): SendTurnInput {
  return {
    input: input.input,
    clientId: input.clientId,
    attachments: input.attachments,
    skillIds: input.skillIds,
    skillReferences: input.skillReferences,
    thinking: input.thinking,
    thinkingEffort: input.thinkingEffort,
    ...(normalizeRuntimeQueuedTurnInputKind(input.kind) === 'plan'
      ? { collaborationMode: 'plan' as const }
      : {}),
  };
}

function cloneQueuedInput(input: RuntimeQueuedTurnInput): RuntimeQueuedTurnInput {
  return {
    ...input,
    kind: normalizeRuntimeQueuedTurnInputKind(input.kind),
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
    skillIds: input.skillIds ? [...input.skillIds] : undefined,
    skillReferences: cloneRuntimeSkillReferences(input.skillReferences),
  };
}

function assertQueuedInputContent(
  kind: RuntimeQueuedTurnInput['kind'],
  text: string,
  attachments: RuntimeQueuedTurnInput['attachments'],
): void {
  if (kind === 'goal' && !text) {
    throw new Error('Queued goal input must include an objective.');
  }
  if (!text && !attachments?.length) {
    throw new Error('Queued input must not be empty.');
  }
}

function assertNoOtherQueuedGoal(
  inputs: RuntimeQueuedTurnInput[],
  ignoredInputId?: string,
): void {
  const hasQueuedGoal = inputs.some((input) => (
    input.id !== ignoredInputId
    && normalizeRuntimeQueuedTurnInputKind(input.kind) === 'goal'
  ));
  if (hasQueuedGoal) {
    throw new Error('A queued goal already exists. Edit or remove it before adding another goal.');
  }
}

function queuedResponse(inputId: string): QueuedTurnInputResponse {
  return {
    accepted: true,
    disposition: 'queued',
    queuedInputId: inputId,
    turnId: null,
  };
}

function normalizeSkillIds(skillIds: string[] | undefined): string[] {
  return [...new Set((skillIds ?? []).map((skillId) => skillId.trim()).filter(Boolean))];
}

function normalizeThinkingEffort(
  thinking: boolean | undefined,
  thinkingEffort: string | undefined,
): string | undefined {
  return thinking === true && thinkingEffort?.trim() ? thinkingEffort.trim() : undefined;
}

function isExpiredSteerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no active turn to steer|active turn is finishing|expected active turn id/i.test(message);
}
