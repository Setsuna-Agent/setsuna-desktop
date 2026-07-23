import type {
  RuntimeDynamicToolDefinition,
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalPatch,
  RuntimeToolCall,
  RuntimeUsage,
  SendTurnInput,
  SendTurnResponse,
  SteerTurnInput,
} from '@setsuna-desktop/contracts';
import type { AppServerNotificationBus } from '../../ports/app-server-notification-bus.js';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { EventBus } from '../../ports/event-bus.js';
import type { GeneratedImageStore } from '../../ports/generated-image-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { PersistentToolApprovalStore } from '../../ports/persistent-tool-approval-store.js';
import type { PolicyAmendmentStore } from '../../ports/policy-amendment-store.js';
import type { ProjectInstructionLoader } from '../../ports/project-instruction-loader.js';
import type { ProjectWorkflowResolver } from '../../ports/project-workflow-resolver.js';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import type { RuntimeDebugTraceSink } from '../../ports/runtime-debug-trace.js';
import type { SkillRegistry } from '../../ports/skill-registry.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { ToolHost } from '../../ports/tool-host.js';
import type { UsageStore } from '../../ports/usage-store.js';
import { RuntimeCompactionTurnCoordinator } from '../context/runtime-compaction-turn-coordinator.js';
import { RuntimeContextCompactor } from '../context/runtime-context-compactor.js';
import { runtimeEnvironmentResolver } from '../context/runtime-environment-resolver.js';
import { RuntimeCollaborationCoordinator } from '../lifecycle/collaboration-coordinator.js';
import { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { RuntimeGoalCoordinator } from '../lifecycle/runtime-goal-coordinator.js';
import { RuntimeHookCoordinator } from '../lifecycle/runtime-hook-coordinator.js';
import { RuntimeThreadTitleCoordinator } from '../lifecycle/runtime-thread-title-coordinator.js';
import { RuntimeTurnFinalizer } from '../lifecycle/runtime-turn-finalizer.js';
import {
  RuntimeTurnInputCoordinator,
  type DeliverMailboxInput,
  type DeliverMailboxResponse,
} from '../lifecycle/runtime-turn-input-coordinator.js';
import { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { RuntimeMemoryCoordinator } from '../memory/runtime-memory-coordinator.js';
import { RuntimeToolCallExecutor } from '../tools/runtime-tool-call-executor.js';
import { RuntimeUserShellRunner } from '../tools/runtime-user-shell-runner.js';
import { RuntimeAgentTurnRunner } from './runtime-agent-turn-runner.js';
import { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import { RuntimeModelSampler } from './runtime-model-sampler.js';
import { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import { RuntimeSamplingContextBuilder } from './runtime-sampling-context-builder.js';
import { TurnCancelledError } from './runtime-turn-errors.js';
import { RuntimeTurnRunFactory, type RuntimeReviewTurnInput } from './runtime-turn-run-factory.js';

export type AgentLoopOptions = {
  attachmentStore?: AttachmentStore;
  threadStore: ThreadStore;
  modelClient: ModelClient;
  eventBus: EventBus;
  clock: Clock;
  ids: IdGenerator;
  imageStore?: GeneratedImageStore;
  approvalGate?: ApprovalGate;
  appServerNotificationBus?: AppServerNotificationBus;
  configStore?: ConfigStore;
  debugTrace?: RuntimeDebugTraceSink;
  skillRegistry?: SkillRegistry;
  toolHost?: ToolHost;
  usageStore?: UsageStore;
  memoryStore?: MemoryStore;
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  projectInstructions?: ProjectInstructionLoader;
  projectWorkflow?: ProjectWorkflowResolver;
  environmentResolver?: RuntimeEnvironmentResolver;
  eventWriter?: RuntimeEventWriter;
};

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
  private readonly goals: RuntimeGoalCoordinator;
  private readonly hooks: RuntimeHookCoordinator;
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
      startTurn: (threadId, input) => this.startTurn(threadId, { input }),
    });
    this.toolExecutor = new RuntimeToolCallExecutor({
      approvalGate: options.approvalGate,
      appServerNotificationBus: options.appServerNotificationBus,
      clock: options.clock,
      ids: options.ids,
      imageStore: options.imageStore,
      memory: this.memory,
      policyAmendmentStore: options.policyAmendmentStore,
      persistentToolApprovalStore: options.persistentToolApprovalStore,
      toolHost: options.toolHost,
      collaborationCoordinator: () => this.collaborationCoordinator,
      goalCoordinator: () => this.goals,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      publishMessage: (threadId, turnId, message) => this.publishMessage(threadId, turnId, message),
    });
    this.hooks = new RuntimeHookCoordinator({
      clock: options.clock,
      environmentResolver,
      ids: options.ids,
      toolExecutor: this.toolExecutor,
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
      mcpStore: options.mcpStore,
      memory: this.memory,
      projectInstructions: options.projectInstructions,
      projectWorkflow: options.projectWorkflow,
      skillRegistry: options.skillRegistry,
      threadStore: options.threadStore,
      toolExecutor: this.toolExecutor,
      toolHost: options.toolHost,
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
      createMailboxTriggeredRun: (threadId, thread, turnId, content) =>
        this.turnRuns.createMailboxTriggered(threadId, thread, turnId, content),
      publishMessage: (threadId, turnId, message) => this.publishMessage(threadId, turnId, message),
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
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      completeMessage: (threadId, turnId, messageId, payload) => this.completeMessage(threadId, turnId, messageId, payload),
      publishAssistantDelta: (threadId, turnId, messageId, text) => this.publishAssistantDelta(threadId, turnId, messageId, text),
      publishMessage: (threadId, turnId, message) => this.publishMessage(threadId, turnId, message),
    });
    this.turnRuns = new RuntimeTurnRunFactory({
      clock: options.clock,
      eventWriter: this.eventWriter,
      ids: options.ids,
      inputGuard: this.inputGuard,
      claimAttachments: (threadId, attachments) => options.attachmentStore?.claimForThread(threadId, attachments) ?? Promise.resolve(attachments),
      threadStore: options.threadStore,
      turnTasks: this.turnTasks,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      normalizeAttachments,
      publishStoredEventsSince: (threadId, sinceSeq) => this.publishStoredEventsSince(threadId, sinceSeq),
      runTurn: (input) => this.turnRunner.run(input),
    });
    this.goals = new RuntimeGoalCoordinator({
      clock: options.clock,
      ids: options.ids,
      threadStore: options.threadStore,
      activeTask: (threadId) => this.turnTasks.activeForThread(threadId),
      cancelTurn: (threadId, turnId) => this.cancelTurn(threadId, turnId),
      createContinuation: (threadId, goal, contextMessages) => this.withThreadMutation(
        threadId,
        () => this.turnRuns.createGoalContinuation(threadId, goal, contextMessages),
      ),
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.userShellRunner = new RuntimeUserShellRunner({
      clock: options.clock,
      environmentResolver,
      ids: options.ids,
      toolHost: options.toolHost,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      cleanupTurn: (context, outcome) => this.turnRunner.cleanupToolHostTurn(context, outcome),
      completeMessage: (threadId, turnId, messageId) => this.completeMessage(threadId, turnId, messageId),
      publishTurnCancelledOnce: (threadId, turnId, taskKind, reason, publishOptions) =>
        this.turnTermination.publishCancelledOnce(threadId, turnId, taskKind, reason, publishOptions),
    });
  }

  flushEvents(): Promise<void> {
    return this.eventWriter.flushAll();
  }

  async shutdown(reason = 'Desktop runtime is shutting down.', timeoutMs = 5_000): Promise<boolean> {
    this.shuttingDown = true;
    this.goals.shutdown();
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
   * 启动一轮异步对话，立即返回 turnId，实际执行在后台继续。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户输入、附件、skill 选择和客户端消息 ID。
   */
  async startTurn(threadId: string, input: SendTurnInput): Promise<SendTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const active = this.turnTasks.activeForThread(threadId);
      if ((active?.taskKind === 'regular' || active?.taskKind === 'goal') && active.acceptingSteers && !active.controller.signal.aborted) {
        // 防御 renderer/SSE 短暂不同步：active 期间的普通发送必须落回当前 turn 的 steer。
        return this.turnInputs.steer(threadId, {
          attachments: input.attachments,
          clientId: input.clientId,
          expectedTurnId: active.turnId,
          input: input.input,
          skillIds: input.skillIds,
          thinking: input.thinking,
          thinkingEffort: input.thinkingEffort,
        });
      }
      const run = await this.turnRuns.createRegular(threadId, input);
      this.goals.observeRun(threadId, run.turnId, 'regular', run.done);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId: run.turnId };
    });
  }

  /**
   * 从某条用户消息重新生成回答，会先截断该消息之后的历史。
   *
   * @param threadId 目标线程 ID。
   * @param messageId 要作为重新生成起点的用户消息 ID。
   * @param input 可选的新内容、skill 选择和思考参数。
   */
  async regenerateFromMessage(threadId: string, messageId: string, input: { content?: string; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string } = {}): Promise<SendTurnResponse> {
    return this.withThreadMutation(threadId, async () => {
      const run = await this.turnRuns.createRegenerate(threadId, messageId, input);
      this.goals.observeRun(threadId, run.turnId, 'regular', run.done);
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
      this.goals.observeRun(threadId, prepared.turnId, 'regular', prepared.done);
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
      this.goals.observeRun(threadId, run.turnId, 'review', run.done);
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
    return this.withThreadMutation(threadId, () => this.goals.resumeIfActive(threadId));
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
  private publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void> {
    return this.modelStreamEvents.publishMessage(threadId, turnId, message);
  }

  private publishAssistantDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void> {
    return this.modelStreamEvents.publishAssistantDelta(threadId, turnId, messageId, text);
  }

  private completeMessage(threadId: string, turnId: string, messageId: string, payload: { content?: string; usage?: RuntimeUsage; toolCalls?: RuntimeToolCall[]; memoryCitation?: RuntimeMemoryCitation; planMode?: RuntimeMessage['planMode']; providerMetadata?: RuntimeMessage['providerMetadata'] } = {}): Promise<void> {
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
    event: Parameters<ThreadStore['appendEvent']>[1],
  ) {
    return this.eventWriter.append(threadId, event);
  }

  private assertAcceptingWork(): void {
    if (this.shuttingDown) throw new Error('Desktop runtime is shutting down and cannot accept new work.');
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

/**
 * 归一化外部输入附件：内联附件必须有 URL，受管文件必须有 opaque asset id。
 *
 * @param value 外部传入的附件字段。
 */
function normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): NonNullable<RuntimeMessage['attachments']>[number] | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
      const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'attachment';
      const type = typeof record.type === 'string' && record.type.trim() ? record.type.trim() : 'application/octet-stream';
      const size = typeof record.size === 'number' && Number.isFinite(record.size) ? Math.max(0, Math.floor(record.size)) : 0;
      if (record.source === 'runtime') {
        const assetId = typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : '';
        if (!id || !assetId) return null;
        return { id, assetId, source: 'runtime' as const, name, type, size };
      }
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : '';
      if (!id || !url) return null;
      return { id, name, type, size, url };
    })
    .filter((item): item is NonNullable<RuntimeMessage['attachments']>[number] => Boolean(item));
}
