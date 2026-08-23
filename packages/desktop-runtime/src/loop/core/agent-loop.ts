import type {
  DeleteQueuedTurnInputResponse,
  QueueTurnInput,
  QueuedTurnInputEditRelease,
  QueuedTurnInputEditReleaseResponse,
  QueuedTurnInputEditSession,
  QueuedTurnInputPatch,
  QueuedTurnInputResponse,
  RegenerateMessageInput,
  RuntimeDynamicToolDefinition,
  RuntimeMemoryCitation,
  RuntimeDataMigrationReadiness,
  RuntimeMessage,
  PendingRuntimeEvent,
  RuntimeEvent,
  StoredThreadEvent,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalPatch,
  RuntimeTaskKind,
  RuntimeToolCall,
  RuntimeUsage,
  SendTurnInput,
  SendTurnResponse,
  StartTurnResponse,
  SteerTurnInput,
} from '@setsuna-desktop/contracts';
import { isCoreRuntimeEvent } from '@setsuna-desktop/contracts';
import {
  createNoopGoalControl,
  type GoalControl,
  type GoalRuntimeHost,
} from '@setsuna-desktop/feature-goal/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { createAutomaticApprovalReviewer } from '../approval-review/automatic-approval-reviewer.js';
import { RuntimeCompactionTurnCoordinator } from '../context/runtime-compaction-turn-coordinator.js';
import { RuntimeContextCompactor } from '../context/runtime-context-compactor.js';
import { runtimeEnvironmentResolver } from '../context/runtime-environment-resolver.js';
import {
  isCollaborationChildLifecycleEvent,
  RuntimeCollaborationCoordinator,
} from '../lifecycle/collaboration-coordinator.js';
import { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { RuntimeHookCoordinator } from '../lifecycle/runtime-hook-coordinator.js';
import { RuntimeQueuedTurnCoordinator } from '../lifecycle/runtime-queued-turn-coordinator.js';
import { RuntimeThreadTitleCoordinator } from '../lifecycle/runtime-thread-title-coordinator.js';
import { RuntimeTurnFinalizer } from '../lifecycle/runtime-turn-finalizer.js';
import { RuntimeTurnInputCoordinator, type DeliverMailboxInput, type DeliverMailboxResponse } from '../lifecycle/runtime-turn-input-coordinator.js';
import { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { RuntimeMemoryCoordinator } from '../memory/runtime-memory-coordinator.js';
import { RuntimeToolCallExecutor } from '../tools/runtime-tool-call-executor.js';
import { RuntimeUserShellRunner } from '../tools/runtime-user-shell-runner.js';
import type { AgentLoopOptions } from './agent-loop-options.js';
import { normalizeAttachments } from './runtime-attachment-input.js';
import { RuntimeAgentTurnRunner } from './runtime-agent-turn-runner.js';
import { createRuntimeGoalHost } from './runtime-goal-host.js';
import { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import { RuntimeModelSampler } from './runtime-model-sampler.js';
import { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import { RuntimeSamplingContextBuilder } from './runtime-sampling-context-builder.js';
import { TurnCancelledError } from './runtime-turn-errors.js';
import { RuntimeTurnRunFactory, type RuntimeReviewTurnInput } from './runtime-turn-run-factory.js';

export type { AgentLoopOptions } from './agent-loop-options.js';
export type { DeliverMailboxInput, DeliverMailboxResponse } from '../lifecycle/runtime-turn-input-coordinator.js';
export class AgentLoop {
  private readonly turnTasks = new RuntimeTurnTaskRegistry();
  private readonly eventWriter: RuntimeEventWriter;
  private readonly memory: RuntimeMemoryCoordinator;
  private readonly modelStreamEvents: RuntimeModelStreamEventPublisher;
  private readonly inputGuard: RuntimeModelInputGuard;
  private readonly contextCompactor: RuntimeContextCompactor;
  private readonly compactionTurns: RuntimeCompactionTurnCoordinator;
  private readonly collaborationCoordinator: RuntimeCollaborationCoordinator;
  private goals: GoalControl = createNoopGoalControl();
  private readonly hooks: RuntimeHookCoordinator;
  private readonly queuedTurns: RuntimeQueuedTurnCoordinator;
  private readonly samplingContexts: RuntimeSamplingContextBuilder;
  private readonly threadTitles: RuntimeThreadTitleCoordinator;
  private readonly toolExecutor: RuntimeToolCallExecutor;
  private readonly turnFinalizer: RuntimeTurnFinalizer;
  private readonly turnInputs: RuntimeTurnInputCoordinator;
  private readonly turnRunner: RuntimeAgentTurnRunner;
  private readonly turnRuns: RuntimeTurnRunFactory;
  private readonly turnTermination: RuntimeTurnTerminationCoordinator;
  private readonly modelSampler: RuntimeModelSampler;
  private readonly userShellRunner: RuntimeUserShellRunner;
  private readonly deletingThreads = new Set<string>();
  private readonly threadMutationAdmissions = new Map<string, Set<Promise<void>>>();
  private shuttingDown = false;
  private dataMigrationPreparing = false;

  constructor(private readonly options: AgentLoopOptions) {
    const environmentResolver = runtimeEnvironmentResolver(options.environmentResolver, options.toolHost);
    this.eventWriter = options.eventWriter ?? new RuntimeEventWriter(options.threadStore, options.eventBus);
    this.memory = new RuntimeMemoryCoordinator({
      clock: options.clock,
      configStore: options.configStore,
      ids: options.ids,
      memoryStore: options.memoryStore,
      modelClient: options.modelClient,
      threadStore: options.threadStore,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.modelStreamEvents = new RuntimeModelStreamEventPublisher({
      clock: options.clock,
      ids: options.ids,
      memoryStore: options.memoryStore,
      appendEvent: (threadId, event) => this.appendAndPublishWithResult(threadId, event),
    });
    this.inputGuard = new RuntimeModelInputGuard(options.configStore);
    this.collaborationCoordinator = new RuntimeCollaborationCoordinator({
      clock: options.clock,
      ids: options.ids,
      threadStore: options.threadStore,
      activeTask: (threadId) => this.turnTasks.activeForThread(threadId),
      cancelTurn: (threadId, turnId) => this.cancelTurn(threadId, turnId),
      deliverMailbox: (threadId, input) => this.deliverMailboxInput(threadId, input),
      startTurn: async (threadId, input) => {
        const started = await this.startSubagentTurn(threadId, input);
        if ('queuedInputId' in started && !started.turnId) {
          throw new Error(`Collaboration turn was queued instead of started: ${started.queuedInputId}`);
        }
        if (!started.turnId) throw new Error('Collaboration turn did not return a turn id.');
        return { turnId: started.turnId };
      },
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.toolExecutor = new RuntimeToolCallExecutor({
      approvalGate: options.approvalGate,
      approvalReviewer: createAutomaticApprovalReviewer(options),
      appServerNotificationBus: options.appServerNotificationBus,
      clock: options.clock,
      ids: options.ids,
      imageStore: options.imageStore,
      memory: this.memory,
      policyAmendmentStore: options.policyAmendmentStore,
      persistentToolApprovalStore: options.persistentToolApprovalStore,
      extensions: options.extensionManager,
      toolHost: options.toolHost,
      toolResultStore: options.toolResultStore,
      collaborationCoordinator: () => this.collaborationCoordinator,
      goalCoordinator: () => this.goals,
      threadStore: options.threadStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      publishMessage: (threadId, turnId, message) => this.publishMessage(threadId, turnId, message),
    });
    this.hooks = new RuntimeHookCoordinator({
      clock: options.clock,
      environmentResolver,
      ids: options.ids,
      toolExecutor: this.toolExecutor,
      extensions: options.extensionManager,
    });
    this.contextCompactor = new RuntimeContextCompactor({
      clock: options.clock,
      debugTrace: options.debugTrace,
      ids: options.ids,
      modelClient: options.modelClient,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublishWithResult(threadId, event),
      onCompacted: (threadId) => this.hooks.queueSessionStartSource(threadId, 'compact'),
      runCompactHooks: (input) => this.hooks.runCompactHooks(input),
    });
    this.samplingContexts = new RuntimeSamplingContextBuilder({
      approvalGate: options.approvalGate,
      attachmentStore: options.attachmentStore,
      clock: options.clock,
      configStore: options.configStore,
      contextCompactor: this.contextCompactor,
      debugTrace: options.debugTrace,
      environmentResolver,
      ids: options.ids,
      goalControl: () => this.goals,
      mcpStore: options.mcpStore,
      memory: this.memory,
      projectInstructions: options.projectInstructions,
      projectWorkflow: options.projectWorkflow,
      skillRegistry: options.skillRegistry,
      threadStore: options.threadStore,
      toolExecutor: this.toolExecutor,
      toolHost: options.toolHost,
      toolResultStore: options.toolResultStore,
    });
    this.modelSampler = new RuntimeModelSampler({
      clock: options.clock,
      ids: options.ids,
      modelClient: options.modelClient,
      streamEvents: this.modelStreamEvents,
      toolExecutor: this.toolExecutor,
    });
    this.threadTitles = new RuntimeThreadTitleCoordinator({
      clock: options.clock,
      configStore: options.configStore,
      eventWriter: this.eventWriter,
      ids: options.ids,
      modelClient: options.modelClient,
      threadStore: options.threadStore,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.turnFinalizer = new RuntimeTurnFinalizer({
      clock: options.clock,
      ids: options.ids,
      memory: this.memory,
      streamEvents: this.modelStreamEvents,
      threadTitles: this.threadTitles,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.turnTermination = new RuntimeTurnTerminationCoordinator({
      clock: options.clock,
      eventWriter: this.eventWriter,
      ids: options.ids,
      threadStore: options.threadStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.compactionTurns = new RuntimeCompactionTurnCoordinator({
      clock: options.clock,
      configStore: options.configStore,
      contextCompactor: this.contextCompactor,
      hooks: this.hooks,
      ids: options.ids,
      threadStore: options.threadStore,
      turnTasks: this.turnTasks,
      turnTermination: this.turnTermination,
      observeRun: (threadId, turnId, done) =>
        this.queuedTurns.observeRun(threadId, turnId, 'compact', done),
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.turnInputs = new RuntimeTurnInputCoordinator({
      clock: options.clock,
      ids: options.ids,
      inputGuard: this.inputGuard,
      claimAttachments: (threadId, attachments) => options.attachmentStore?.claimForThread(threadId, attachments) ?? Promise.resolve(attachments),
      normalizeAttachments,
      threadStore: options.threadStore,
      turnTasks: this.turnTasks,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      createMailboxTriggeredRun: async (threadId, thread, turnId, content) => {
        const run = await this.turnRuns.createMailboxTriggered(threadId, thread, turnId, content);
        this.observeRun(threadId, run.turnId, 'regular', run.done);
        return run;
      },
      publishMessage: (threadId, turnId, message, publishOptions) =>
        this.publishMessage(threadId, turnId, message, publishOptions),
    });
    this.turnRunner = new RuntimeAgentTurnRunner({
      clock: options.clock,
      collaborationCoordinator: this.collaborationCoordinator,
      configStore: options.configStore,
      hooks: this.hooks,
      ids: options.ids,
      modelSampler: this.modelSampler,
      samplingContexts: this.samplingContexts,
      threadTitles: this.threadTitles,
      toolExecutor: this.toolExecutor,
      toolHost: options.toolHost,
      turnFinalizer: this.turnFinalizer,
      turnInputs: this.turnInputs,
      turnTasks: this.turnTasks,
      turnTermination: this.turnTermination,
      extensions: options.extensionManager,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      completeMessage: (threadId, turnId, messageId, payload) => this.completeMessage(threadId, turnId, messageId, payload),
      publishAssistantDelta: (threadId, turnId, messageId, text) => this.publishAssistantDelta(threadId, turnId, messageId, text),
      publishAssistantItemDelta: (threadId, turnId, messageId, text) => this.modelStreamEvents.publishAssistantItemDelta(threadId, turnId, messageId, text),
      publishMessage: (threadId, turnId, message, publishOptions) =>
        this.publishMessage(threadId, turnId, message, publishOptions),
    });
    this.turnRuns = new RuntimeTurnRunFactory({
      clock: options.clock,
      configStore: options.configStore,
      eventWriter: this.eventWriter,
      ids: options.ids,
      inputGuard: this.inputGuard,
      claimAttachments: (threadId, attachments) => options.attachmentStore?.claimForThread(threadId, attachments) ?? Promise.resolve(attachments),
      threadStore: options.threadStore,
      turnTasks: this.turnTasks,
      normalizeAttachments,
      publishStoredEventsSince: (threadId, sinceSeq) => this.publishStoredEventsSince(threadId, sinceSeq),
      runTurn: (input) => this.turnRunner.run(input),
    });
    this.queuedTurns = new RuntimeQueuedTurnCoordinator({
      clock: options.clock,
      ids: options.ids,
      inputGuard: this.inputGuard,
      threadStore: options.threadStore,
      turnTasks: this.turnTasks,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      claimAttachments: (threadId, attachments) =>
        options.attachmentStore?.claimForThread(threadId, attachments) ?? Promise.resolve(attachments),
      normalizeAttachments,
      validateGoalInput: (threadId, objective) =>
        this.goals.validateQueuedGoal(threadId, objective),
      startRegularTurn: (threadId, input, queuedInputId) =>
        this.withThreadMutation(
          threadId,
          () => this.turnRuns.createRegular(threadId, input, { queuedInputId }),
        ),
      startGoalTurn: (threadId, input) =>
        this.withThreadMutation(
          threadId,
          () => this.goals.startQueuedGoal(threadId, input),
        ),
      steerQueuedInput: (threadId, activeTurnId, input) =>
        this.turnInputs.steerQueuedInput(threadId, activeTurnId, input),
      // 队列协调器已经观察自己的 run；这里只接入目标计量与续轮调度。
      onRunCreated: (threadId, turnId, taskKind, done) =>
        this.goals.observeRun(threadId, turnId, taskKind, done),
    });
    this.userShellRunner = new RuntimeUserShellRunner({
      clock: options.clock,
      environmentResolver,
      ids: options.ids,
      toolHost: options.toolHost,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      cleanupTurn: (context, outcome) => this.turnRunner.cleanupToolHostTurn(context, outcome),
      completeMessage: (threadId, turnId, messageId) => this.completeMessage(
        threadId,
        turnId,
        messageId,
        { phase: 'commentary' },
      ),
      publishTurnCancelledOnce: (threadId, turnId, taskKind, reason, publishOptions) =>
        this.turnTermination.publishCancelledOnce(threadId, turnId, taskKind, reason, publishOptions),
    });
  }

  flushEvents(): Promise<void> {
    return this.eventWriter.flushAll();
  }

  /**
   * Atomically closes turn/mutation admission when the runtime is already quiescent.
   * Cancelled tasks remain registered until their terminal writes finish, so they block too.
   */
  prepareDataMigration(additionalPendingMutations = 0): RuntimeDataMigrationReadiness {
    const registeredTasks = this.turnTasks.registeredTaskCount();
    const pendingMutations = Math.max(0, additionalPendingMutations)
      + [...this.threadMutationAdmissions.values()]
        .reduce((total, admissions) => total + admissions.size, 0)
      + this.memory.pendingBackgroundTaskCount();
    const ready = !this.shuttingDown
      && !this.dataMigrationPreparing
      && registeredTasks === 0
      && pendingMutations === 0;
    if (ready) this.dataMigrationPreparing = true;
    return { ready, registeredTasks, pendingMutations };
  }

  cancelDataMigrationPreparation(): void {
    if (!this.shuttingDown) this.dataMigrationPreparing = false;
  }

  async shutdown(reason = 'Desktop runtime is shutting down.', timeoutMs = 5_000): Promise<boolean> {
    this.shuttingDown = true;
    this.goals.shutdown();
    this.queuedTurns.shutdown();
    const error = new TurnCancelledError(reason);
    const tasks = this.turnTasks.cancelAll(error);
    this.options.approvalGate?.rejectPending?.(error);
    this.toolExecutor.shutdown(error);
    this.turnInputs.clear();
    const memoryDrained = this.memory.shutdown(timeoutMs);
    await Promise.allSettled(tasks.map((task) =>
      this.turnTermination.publishCancelledOnce(task.threadId, task.turnId, task.taskKind, reason, { marker: true }),
    ));
    const drained = await this.turnTasks.drain(timeoutMs);
    // Drain Goal observers before flushing so accounting cannot arrive after shutdown.
    if (drained) await this.goals.waitForSettlements();
    const backgroundDrained = await memoryDrained;
    await this.eventWriter.flushAll();
    return drained && backgroundDrained;
  }

  /**
   * 启动时回扫近期 idle 线程，补抽历史对话的长期记忆候选。
   * 这是本地 runtime 对记忆启动第一阶段的轻量实现：负责候选选择和提取，
   * 真正的全局 stage1/phase2 状态机仍由后续 storage/consolidation 层承接。
   */
  async runMemoryStartupExtraction(): Promise<{ claimed: number; extracted: number }> {
    return this.memory.runStartupExtraction();
  }

  /**
   * 启动一轮异步对话。线程忙碌或队列被编辑时只持久化输入并返回 queued 成功态；
   * 真正启动的轮次仍在后台执行。
   * @param threadId 目标线程 ID。
   * @param input 用户输入、附件、skill 选择和客户端消息 ID。
   */
  async startTurn(threadId: string, input: SendTurnInput): Promise<StartTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const active = this.turnTasks.activeForThread(threadId);
      const hasQueuedInput = await this.queuedTurns.hasPending(threadId);
      if (active || hasQueuedInput) {
        // 防御 renderer/SSE 短暂不同步：即使客户端误走普通发送入口，也必须进入
        // 跨轮次队列。线程因错误暂停时也先恢复旧项，避免新输入越过 FIFO。
        const queued = await this.queuedTurns.enqueue(threadId, {
          attachments: input.attachments,
          clientId: input.clientId,
          input: input.input,
          kind: 'message',
          modelSelection: input.modelSelection,
          skillIds: input.skillIds,
          skillReferences: input.skillReferences,
          thinking: input.thinking,
          thinkingEffort: input.thinkingEffort,
        });
        // turn.input_queued 已经持久化后必须返回成功；否则客户端恢复草稿重试会制造重复项。
        return queued;
      }
      const run = await this.turnRuns.createRegular(threadId, input);
      this.observeRun(threadId, run.turnId, 'regular', run.done);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId: run.turnId };
    });
  }

  /**
   * 启动子代理 turn：调用者是父线程的协作协调器，不是用户，因此走独立入口
   * （taskKind subagent + collaboration prompt source），不能复用普通 startTurn。
   */
  async startSubagentTurn(
    threadId: string,
    input: { prompt: string; title?: string },
  ): Promise<StartTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const run = await this.turnRuns.createSubagent(threadId, input);
      this.observeRun(threadId, run.turnId, 'subagent', run.done);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId: run.turnId };
    });
  }

  /**
   * 重启后把账本上仍非终态、但 child 已无活动 turn 的协作任务修正为 interrupted。
   * 必须在 settleStaleRuntimeTurns 之后调用。
   */
  reconcileCollaborationTasks(): Promise<void> {
    return this.collaborationCoordinator.reconcileInterruptedTasks();
  }

  /**
   * 从某条用户消息重新生成回答，会先截断该消息之后的历史。
   *
   * @param threadId 目标线程 ID。
   * @param messageId 要作为重新生成起点的用户消息 ID。
   * @param input 可选的新内容、skill 选择和思考参数。
   */
  async regenerateFromMessage(threadId: string, messageId: string, input: RegenerateMessageInput = {}): Promise<SendTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const run = await this.turnRuns.createRegenerate(threadId, messageId, input);
      this.observeRun(threadId, run.turnId, 'regular', run.done);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId: run.turnId };
    });
  }

  /**
   * 同步执行一轮对话，主要给测试或命令式调用等待完整结果使用。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户输入、附件和 skill 选择。
   */
  async sendTurn(threadId: string, input: SendTurnInput): Promise<void> {
    const run = await this.withThreadMutation(threadId, async () => {
      const prepared = await this.turnRuns.createRegular(threadId, input);
      this.observeRun(threadId, prepared.turnId, 'regular', prepared.done);
      return prepared;
    });
    await run.done;
    // 传统命令式调用方会在 sendTurn 中等待被动记忆处理完成。
    // HTTP 和界面调用方使用 startTurn，并在 turn.completed 持久化后立即返回。
    await this.memory.waitForPassiveMemoriesForTurn(threadId, run.turnId);
  }

  /**
   * 清空线程上下文，并把下一轮 SessionStart 标记为 clear source。
   *
   * @param threadId 需要清空上下文的线程 ID。
   */
  async clearThreadContext(threadId: string): Promise<RuntimeThread> {
    return this.withThreadMutation(threadId, async () => {
      await this.eventWriter.flushThread(threadId);
      const beforeSeq = (await this.options.threadStore.getThread(threadId))?.lastSeq ?? 0;
      const thread = await this.options.threadStore.clearThreadMessages(threadId);
      this.hooks.queueSessionStartSource(threadId, 'clear');
      await this.publishStoredEventsSince(threadId, beforeSeq);
      return thread;
    });
  }

  /**
   * 启动 review turn，展示文本和模型 prompt 可以不同。
   *
   * @param threadId 目标线程 ID。
   * @param input review 的用户可见文本和模型实际 prompt。
   */
  async startReview(threadId: string, input: RuntimeReviewTurnInput): Promise<SendTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const run = await this.turnRuns.createReview(threadId, input);
      this.observeRun(threadId, run.turnId, 'review', run.done);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId: run.turnId };
    });
  }

  /**
   * 取消指定 turn，返回 false 表示该 turn 已不存在或已经结束。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 要取消的 turn ID。
   */
  async cancelTurn(threadId: string, turnId: string): Promise<boolean> {
    const task = this.turnTasks.taskFor(threadId, turnId);
    // 中止前先暂停，防止任务的 finally 或空闲观察器竞态进入下一个目标轮次。
    if (task?.taskKind === 'goal') await this.goals.pauseForCancellation(threadId);
    const cancelled = this.turnTasks.cancel(threadId, turnId, new TurnCancelledError());
    if (!cancelled) return false;
    // 取消是最高优先级交互：先落终态事件释放 UI，不等待 provider/tool 主动响应 AbortSignal。
    await this.turnTermination.publishCancelledOnce(threadId, turnId, task?.taskKind ?? 'regular', 'Turn cancelled.', { marker: true });
    return true;
  }

  /**
   * Prevents new turns, drains even an already-aborted registered task, then runs the destructive
   * thread operation. The operation is never reached while task or cancellation writes can arrive.
   */
  async withThreadDeletionBarrier<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    if (this.deletingThreads.has(threadId)) throw new Error(`thread ${threadId} is already being deleted`);
    this.deletingThreads.add(threadId);
    try {
      this.turnTasks.blockThread(threadId);
    } catch (error) {
      this.deletingThreads.delete(threadId);
      throw error;
    }
    this.goals.beginThreadDeletion(threadId);
    let deleted = false;
    try {
      // Drain tasks first so an admitted synchronous caller waiting on task.done can observe abort.
      // Then wait all older mutations (attachment claims, regeneration, shell, compact, goal and
      // context writes) before the final task check and destructive commit.
      await this.drainRegisteredTasksForDeletion(threadId);
      await this.waitForThreadMutationAdmissions(threadId);
      await this.drainRegisteredTasksForDeletion(threadId);
      // A concurrent user cancel can hide the task from activeTurnId before its terminal writes settle.
      await this.turnTermination.waitForThread(threadId);
      await this.goals.waitForThreadDeletionPause(threadId);
      await this.eventWriter.flushThread(threadId);
      const result = await operation();
      deleted = true;
      return result;
    } finally {
      this.goals.finishThreadDeletion(threadId, deleted);
      this.turnTasks.unblockThread(threadId);
      this.deletingThreads.delete(threadId);
    }
  }

  /**
   * 查询线程当前运行中的 turnId，供 renderer 恢复 active 状态。
   *
   * @param threadId 要查询的线程 ID。
   */
  activeTurnId(threadId: string): string | null {
    return this.turnTasks.activeForThread(threadId)?.turnId ?? null;
  }

  /** Binds the optional Goal Feature after runtime composition has activated it. */
  bindGoalControl(control: GoalControl): void {
    if (this.goals.available && this.goals !== control) {
      throw new Error('Goal control is already bound.');
    }
    this.goals = control;
  }

  /** Narrow host surface supplied to the Goal Feature by the runtime composition root. */
  goalRuntimeHost(): GoalRuntimeHost {
    return createRuntimeGoalHost({
      clock: this.options.clock,
      ids: this.options.ids,
      threadStore: this.options.threadStore,
      eventWriter: this.eventWriter,
      queuedTurns: this.queuedTurns,
      turnRuns: this.turnRuns,
      turnTasks: this.turnTasks,
      turnTermination: this.turnTermination,
      cancelTurn: (threadId, turnId) => this.cancelTurn(threadId, turnId),
      mutateThread: (threadId, operation) => this.withThreadMutation(threadId, operation),
    });
  }

  getThreadGoal(threadId: string): Promise<RuntimeThreadGoal | null> {
    return this.goals.getGoal(threadId);
  }

  setThreadGoal(threadId: string, patch: RuntimeThreadGoalPatch): Promise<RuntimeThreadGoal> {
    return this.withThreadMutation(threadId, () => this.goals.setGoal(threadId, patch));
  }

  clearThreadGoal(threadId: string): Promise<void> {
    return this.withThreadMutation(threadId, () => this.goals.clearGoal(threadId));
  }

  resumeThreadGoal(threadId: string): Promise<void> {
    return this.withThreadMutation(threadId, () => this.goals.resumeGoal(threadId));
  }

  reconcileRestoredGoals(): Promise<void> {
    return this.goals.reconcileRestoredGoals();
  }

  registerAppServerDynamicTools(threadId: string, tools: RuntimeDynamicToolDefinition[], connectionId: string): void {
    this.assertThreadAcceptingWork(threadId);
    this.toolExecutor.registerDynamicTools(threadId, tools, connectionId);
  }

  clearAppServerDynamicTools(threadId: string): void {
    this.toolExecutor.clearDynamicTools(threadId);
  }

  answerAppServerDynamicToolResponse(id: string | number | null | undefined, response: { result?: unknown; error?: unknown }): boolean {
    return this.toolExecutor.answerDynamicToolResponse(id, response);
  }

  /**
   * 向正在运行的普通对话 turn 追加用户输入，不创建新的 turn。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户补充输入；expectedTurnId 用来防止补充写入过期 turn。
   */
  async steerTurn(threadId: string, input: SteerTurnInput): Promise<SendTurnResponse> {
    return this.withThreadMutation(threadId, () => this.turnInputs.steer(threadId, input));
  }

  /** 将用户输入持久化到线程级发送队列；线程空闲时会立即启动该项。 */
  async queueTurnInput(
    threadId: string,
    input: QueueTurnInput,
  ): Promise<QueuedTurnInputResponse> {
    return this.withThreadMutation(threadId, () => this.queuedTurns.enqueue(threadId, input));
  }

  async retrieveQueuedTurnInput(
    threadId: string,
    inputId: string,
  ): Promise<QueuedTurnInputEditSession> {
    return this.withThreadMutation(
      threadId,
      () => this.queuedTurns.retrieveForEditing(threadId, inputId),
    );
  }

  async releaseQueuedTurnInputEdit(
    threadId: string,
    inputId: string,
    input: QueuedTurnInputEditRelease,
  ): Promise<QueuedTurnInputEditReleaseResponse> {
    return this.withThreadMutation(
      threadId,
      () => this.queuedTurns.releaseEditing(threadId, inputId, input),
    );
  }

  async updateQueuedTurnInput(
    threadId: string,
    inputId: string,
    patch: QueuedTurnInputPatch,
  ): Promise<QueuedTurnInputResponse> {
    return this.withThreadMutation(
      threadId,
      () => this.queuedTurns.updateAfterEditing(threadId, inputId, patch),
    );
  }

  async deleteQueuedTurnInput(
    threadId: string,
    inputId: string,
  ): Promise<DeleteQueuedTurnInputResponse> {
    return this.withThreadMutation(threadId, async () => ({
      deleted: await this.queuedTurns.delete(threadId, inputId),
    }));
  }

  async sendQueuedTurnInputNow(
    threadId: string,
    inputId: string,
  ): Promise<QueuedTurnInputResponse> {
    return this.withThreadMutation(threadId, () => this.queuedTurns.sendNow(threadId, inputId));
  }

  /**
   * 向当前 active turn 投递来自子 agent/协作方的 mailbox 消息。
   *
   * @param threadId 目标线程 ID。
   * @param input mailbox 内容和可选来源。
   */
  async deliverMailboxInput(threadId: string, input: DeliverMailboxInput): Promise<DeliverMailboxResponse> {
    return this.withThreadMutation(threadId, () => this.turnInputs.deliverMailbox(threadId, input));
  }

  async runUserShellCommand(threadId: string, command: string, activeTurnId: string | null = null): Promise<void> {
    return this.withThreadMutation(
      threadId,
      () => this.runAdmittedUserShellCommand(threadId, command, activeTurnId),
    );
  }

  private async runAdmittedUserShellCommand(threadId: string, command: string, activeTurnId: string | null): Promise<void> {
    const text = command.trim();
    if (!text) throw new Error('command must not be empty');
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    if (activeTurnId) {
      const active = this.turnTasks.activeForThread(threadId);
      await this.userShellRunner.execute({
        activeTurnId,
        command: text,
        signal: active?.turnId === activeTurnId ? active.controller.signal : undefined,
        standaloneTurn: false,
        thread,
        threadId,
        turnId: activeTurnId,
      });
      return;
    }

    const turnId = this.options.ids.id('turn_shell');
    const run = this.turnTasks.run({
      acceptingSteers: false,
      taskKind: 'user_shell',
      threadId,
      turnId,
    }, (task) => this.userShellRunner.execute({
      command: text,
      signal: task.controller.signal,
      standaloneTurn: true,
      thread,
      threadId,
      turnId,
    }));
    this.queuedTurns.observeRun(threadId, turnId, 'user_shell', run.done);
    await run.done;
  }

  /**
   * 手动压缩线程上下文，并把压缩生命周期写入线程事件流。
   *
   * @param threadId 需要压缩上下文的线程 ID。
   * @param force 是否忽略 token 阈值强制压缩。
   */
  compactThreadContext(threadId: string, force = true): Promise<RuntimeThread> {
    return this.withThreadMutation(threadId, () => this.compactionTurns.compact(threadId, force));
  }
  /**
   * 以 message.created 事件写入并广播一条完整消息。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 消息所属 turn ID。
   * @param message 要写入线程的 runtime message。
   */
  private publishMessage(
    threadId: string,
    turnId: string,
    message: RuntimeMessage,
    options: { queuedInputId?: string } = {},
  ): Promise<void> {
    return this.modelStreamEvents.publishMessage(threadId, turnId, message, options);
  }

  private publishAssistantDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void> {
    return this.modelStreamEvents.publishAssistantDelta(threadId, turnId, messageId, text);
  }

  private completeMessage(threadId: string, turnId: string, messageId: string, payload: { content?: string; phase: NonNullable<RuntimeMessage['phase']>; usage?: RuntimeUsage; toolCalls?: RuntimeToolCall[]; memoryCitation?: RuntimeMemoryCitation; providerMetadata?: RuntimeMessage['providerMetadata'] }): Promise<void> {
    return this.modelStreamEvents.completeMessage(threadId, turnId, messageId, payload);
  }
  /**
   * 追加事件到线程存储后广播给订阅者。
   *
   * @param threadId 目标线程 ID。
   * @param event 未分配 seq 前的 runtime event。
   */
  private async appendAndPublish(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void> {
    // 先落盘再发布，订阅端按 seq 重放时才能得到和存储一致的事件顺序。
    await this.appendAndPublishWithResult(threadId, event);
  }

  private appendAndPublishWithResult(
    threadId: string,
    event: PendingRuntimeEvent,
  ): Promise<RuntimeEvent | null>;
  private appendAndPublishWithResult(
    threadId: string,
    event: Parameters<ThreadStore['appendEvent']>[1],
  ): Promise<StoredThreadEvent | null>;
  private appendAndPublishWithResult(
    threadId: string,
    event: Parameters<ThreadStore['appendEvent']>[1],
  ): Promise<StoredThreadEvent | null> {
    const saved = this.eventWriter.append(threadId, event);
    // 仅转发协作协调器实际处理的 child 生命周期，避免普通消息和工具事件为判断
    // “是否 child”反复读取、克隆整条线程快照。
    void saved.then((savedEvent) => {
      if (savedEvent && isCoreRuntimeEvent(savedEvent) && isCollaborationChildLifecycleEvent(savedEvent)) {
        return this.collaborationCoordinator.observeChildEvent(savedEvent);
      }
      return undefined;
    }).catch(() => undefined);
    return saved;
  }

  private assertAcceptingWork(): void {
    if (this.shuttingDown || this.dataMigrationPreparing) {
      throw new Error('Desktop runtime is preparing to stop and cannot accept new work.');
    }
  }

  private observeRun(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    done: Promise<void>,
  ): void {
    this.goals.observeRun(threadId, turnId, taskKind, done);
    this.queuedTurns.observeRun(threadId, turnId, taskKind, done);
  }

  private assertThreadAcceptingWork(threadId: string): void {
    this.assertAcceptingWork();
    if (this.deletingThreads.has(threadId)) {
      throw new Error(`thread ${threadId} is being deleted and cannot accept new work`);
    }
  }

  /** Runs a per-thread mutation under the same admission boundary used by destructive deletion. */
  async withThreadMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    this.assertThreadAcceptingWork(threadId);
    let resolveAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => {
      resolveAdmission = resolve;
    });
    const pending = this.threadMutationAdmissions.get(threadId) ?? new Set<Promise<void>>();
    pending.add(admission);
    this.threadMutationAdmissions.set(threadId, pending);
    try {
      await this.turnRuns.persistInferredThreadModelBinding(threadId);
      return await operation();
    } finally {
      pending.delete(admission);
      if (!pending.size && this.threadMutationAdmissions.get(threadId) === pending) {
        this.threadMutationAdmissions.delete(threadId);
      }
      resolveAdmission();
    }
  }

  private async waitForThreadMutationAdmissions(threadId: string): Promise<void> {
    for (;;) {
      const pending = [...(this.threadMutationAdmissions.get(threadId) ?? [])];
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  private async drainRegisteredTasksForDeletion(threadId: string): Promise<void> {
    for (;;) {
      const task = this.turnTasks.registeredForThread(threadId);
      if (!task) return;
      if (!task.controller.signal.aborted) await this.cancelTurn(threadId, task.turnId);
      if (!task.done) throw new Error(`thread ${threadId} has a registered turn without a completion promise`);
      await task.done.catch(() => undefined);
    }
  }

  /**
   * 重新广播指定 seq 之后的已存储事件，用于重生成后同步 renderer。
   *
   * @param threadId 目标线程 ID。
   * @param sinceSeq 只发布大于该 seq 的事件。
   */
  private async publishStoredEventsSince(threadId: string, sinceSeq: number): Promise<void> {
    const events = await this.options.threadStore.listEvents(threadId, sinceSeq);
    for (const event of events) this.options.eventBus.publish(event);
  }

}
