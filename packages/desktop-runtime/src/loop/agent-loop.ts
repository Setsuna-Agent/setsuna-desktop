import type { RuntimeDynamicToolDefinition, RuntimeMemoryCitation, RuntimeMessage, RuntimeThread, RuntimeThreadGoal, RuntimeThreadGoalPatch, RuntimeToolCall, RuntimeUsage, SendTurnInput, SendTurnResponse, SteerTurnInput } from '@setsuna-desktop/contracts';
import type { AppServerNotificationBus } from '../ports/app-server-notification-bus.js';
import type { ApprovalGate } from '../ports/approval-gate.js';
import type { Clock } from '../ports/clock.js';
import type { ConfigStore } from '../ports/config-store.js';
import type { EventBus } from '../ports/event-bus.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { MemoryStore } from '../ports/memory-store.js';
import type { McpStore } from '../ports/mcp-store.js';
import type { ModelClient } from '../ports/model-client.js';
import type { PolicyAmendmentStore } from '../ports/policy-amendment-store.js';
import type { PersistentToolApprovalStore } from '../ports/persistent-tool-approval-store.js';
import type { ProjectInstructionLoader } from '../ports/project-instruction-loader.js';
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { ToolHost } from '../ports/tool-host.js';
import type { UsageStore } from '../ports/usage-store.js';
import { RuntimeAgentTurnRunner } from './runtime-agent-turn-runner.js';
import { RuntimeCollaborationCoordinator } from './collaboration-coordinator.js';
import { RuntimeCompactionTurnCoordinator } from './runtime-compaction-turn-coordinator.js';
import { RuntimeEventWriter } from './runtime-event-writer.js';
import { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import { RuntimeModelSampler } from './runtime-model-sampler.js';
import { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import { RuntimeHookCoordinator } from './runtime-hook-coordinator.js';
import { RuntimeSamplingContextBuilder } from './runtime-sampling-context-builder.js';
import { RuntimeThreadTitleCoordinator } from './runtime-thread-title-coordinator.js';
import { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import { RuntimeTurnFinalizer } from './runtime-turn-finalizer.js';
import { RuntimeTurnInputCoordinator, type DeliverMailboxInput, type DeliverMailboxResponse } from './runtime-turn-input-coordinator.js';
import { RuntimeTurnRunFactory, type RuntimeReviewTurnInput } from './runtime-turn-run-factory.js';
import { RuntimeTurnTerminationCoordinator } from './runtime-turn-termination-coordinator.js';
import { TurnCancelledError } from './runtime-turn-errors.js';
import { RuntimeUserShellRunner } from './runtime-user-shell-runner.js';
import { RuntimeContextCompactor } from './runtime-context-compactor.js';
import { RuntimeTurnTaskRegistry } from './turn-task-registry.js';
import { RuntimeGoalCoordinator } from './runtime-goal-coordinator.js';

export type AgentLoopOptions = {
  threadStore: ThreadStore;
  modelClient: ModelClient;
  eventBus: EventBus;
  clock: Clock;
  ids: IdGenerator;
  approvalGate?: ApprovalGate;
  appServerNotificationBus?: AppServerNotificationBus;
  configStore?: ConfigStore;
  skillRegistry?: SkillRegistry;
  toolHost?: ToolHost;
  usageStore?: UsageStore;
  memoryStore?: MemoryStore;
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  projectInstructions?: ProjectInstructionLoader;
  eventWriter?: RuntimeEventWriter;
};

export type { DeliverMailboxInput, DeliverMailboxResponse } from './runtime-turn-input-coordinator.js';
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
  private shuttingDown = false;

  constructor(private readonly options: AgentLoopOptions) {
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
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
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
      ids: options.ids,
      toolExecutor: this.toolExecutor,
      toolHost: options.toolHost,
    });
    this.contextCompactor = new RuntimeContextCompactor({
      clock: options.clock,
      ids: options.ids,
      modelClient: options.modelClient,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      onCompacted: (threadId) => this.hooks.queueSessionStartSource(threadId, 'compact'),
      runCompactHooks: (input) => this.hooks.runCompactHooks(input),
    });
    this.samplingContexts = new RuntimeSamplingContextBuilder({
      approvalGate: options.approvalGate,
      clock: options.clock,
      configStore: options.configStore,
      contextCompactor: this.contextCompactor,
      mcpStore: options.mcpStore,
      memory: this.memory,
      projectInstructions: options.projectInstructions,
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
      toolExecutor: this.toolExecutor,
      turnTasks: this.turnTasks,
      turnTermination: this.turnTermination,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.turnInputs = new RuntimeTurnInputCoordinator({
      clock: options.clock,
      ids: options.ids,
      inputGuard: this.inputGuard,
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
      createContinuation: (threadId, goal, contextMessages) => this.turnRuns.createGoalContinuation(threadId, goal, contextMessages),
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
    });
    this.userShellRunner = new RuntimeUserShellRunner({
      clock: options.clock,
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
    await Promise.allSettled(tasks.map((task) =>
      this.turnTermination.publishCancelledOnce(task.threadId, task.turnId, task.taskKind, reason, { marker: true }),
    ));
    const drained = await this.turnTasks.drain(timeoutMs);
    await this.eventWriter.flushAll();
    return drained;
  }

  /**
   * 启动时回扫近期 idle 线程，补抽历史对话的长期记忆候选。
   * 这是本地 runtime 对 Codex memory startup phase-1 的轻量对应：负责候选选择和提取，
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
    this.assertAcceptingWork();
    const active = this.turnTasks.activeForThread(threadId);
    if ((active?.taskKind === 'regular' || active?.taskKind === 'goal') && active.acceptingSteers && !active.controller.signal.aborted) {
      // 防御 renderer/SSE 短暂不同步：active 期间的普通发送必须落回当前 turn 的 steer。
      return this.steerTurn(threadId, {
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
  }

  /**
   * 从某条用户消息重新生成回答，会先截断该消息之后的历史。
   *
   * @param threadId 目标线程 ID。
   * @param messageId 要作为重新生成起点的用户消息 ID。
   * @param input 可选的新内容、skill 选择和思考参数。
   */
  async regenerateFromMessage(threadId: string, messageId: string, input: { content?: string; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string } = {}): Promise<SendTurnResponse> {
    this.assertAcceptingWork();
    const run = await this.turnRuns.createRegenerate(threadId, messageId, input);
    this.goals.observeRun(threadId, run.turnId, 'regular', run.done);
    void run.done.catch(() => undefined);
    return { accepted: true, turnId: run.turnId };
  }

  /**
   * 同步执行一轮对话，主要给测试或命令式调用等待完整结果使用。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户输入、附件和 skill 选择。
   */
  async sendTurn(threadId: string, input: SendTurnInput): Promise<void> {
    this.assertAcceptingWork();
    const run = await this.turnRuns.createRegular(threadId, input);
    this.goals.observeRun(threadId, run.turnId, 'regular', run.done);
    await run.done;
  }

  /**
   * 清空线程上下文，并把下一轮 SessionStart 标记为 clear source。
   *
   * @param threadId 需要清空上下文的线程 ID。
   */
  async clearThreadContext(threadId: string): Promise<RuntimeThread> {
    await this.eventWriter.flushThread(threadId);
    const beforeSeq = (await this.options.threadStore.getThread(threadId))?.lastSeq ?? 0;
    const thread = await this.options.threadStore.clearThreadMessages(threadId);
    this.hooks.queueSessionStartSource(threadId, 'clear');
    await this.publishStoredEventsSince(threadId, beforeSeq);
    return thread;
  }

  /**
   * 启动 review turn，展示文本和模型 prompt 可以不同。
   *
   * @param threadId 目标线程 ID。
   * @param input review 的用户可见文本和模型实际 prompt。
   */
  async startReview(threadId: string, input: RuntimeReviewTurnInput): Promise<SendTurnResponse> {
    this.assertAcceptingWork();
    const run = await this.turnRuns.createReview(threadId, input);
    this.goals.observeRun(threadId, run.turnId, 'review', run.done);
    void run.done.catch(() => undefined);
    return { accepted: true, turnId: run.turnId };
  }

  /**
   * 取消指定 turn，返回 false 表示该 turn 已不存在或已经结束。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 要取消的 turn ID。
   */
  async cancelTurn(threadId: string, turnId: string): Promise<boolean> {
    const task = this.turnTasks.taskFor(threadId, turnId);
    // Pause before aborting so the task's finally/idle observer can never race into another goal turn.
    if (task?.taskKind === 'goal') await this.goals.pauseForCancellation(threadId);
    const cancelled = this.turnTasks.cancel(threadId, turnId, new TurnCancelledError());
    if (!cancelled) return false;
    // 取消是最高优先级交互：先落终态事件释放 UI，不等待 provider/tool 主动响应 AbortSignal。
    await this.turnTermination.publishCancelledOnce(threadId, turnId, task?.taskKind ?? 'regular', 'Turn cancelled.', { marker: true });
    return true;
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
    this.assertAcceptingWork();
    return this.goals.setGoal(threadId, patch);
  }

  clearThreadGoal(threadId: string): Promise<void> {
    return this.goals.clearGoal(threadId);
  }

  resumeThreadGoal(threadId: string): Promise<void> {
    this.assertAcceptingWork();
    return this.goals.resumeIfActive(threadId);
  }

  registerAppServerDynamicTools(threadId: string, tools: RuntimeDynamicToolDefinition[], connectionId: string): void {
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
    return this.turnInputs.steer(threadId, input);
  }

  /**
   * 向当前 active turn 投递来自子 agent/协作方的 mailbox 消息。
   *
   * @param threadId 目标线程 ID。
   * @param input mailbox 内容和可选来源。
   */
  async deliverMailboxInput(threadId: string, input: DeliverMailboxInput): Promise<DeliverMailboxResponse> {
    this.assertAcceptingWork();
    return this.turnInputs.deliverMailbox(threadId, input);
  }

  async runUserShellCommand(threadId: string, command: string, activeTurnId: string | null = null): Promise<void> {
    this.assertAcceptingWork();
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
    return this.compactionTurns.compact(threadId, force);
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

  private completeMessage(threadId: string, turnId: string, messageId: string, payload: { content?: string; usage?: RuntimeUsage; toolCalls?: RuntimeToolCall[]; memoryCitation?: RuntimeMemoryCitation; planMode?: RuntimeMessage['planMode'] } = {}): Promise<void> {
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
    await this.eventWriter.append(threadId, event);
  }

  private assertAcceptingWork(): void {
    if (this.shuttingDown) throw new Error('Desktop runtime is shutting down and cannot accept new work.');
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
 * 归一化外部输入附件，过滤缺少 id 或 url 的无效项。
 *
 * @param value 外部传入的附件字段。
 */
function normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
      const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'image';
      const type = typeof record.type === 'string' && record.type.trim() ? record.type.trim() : 'application/octet-stream';
      const size = typeof record.size === 'number' && Number.isFinite(record.size) ? Math.max(0, Math.floor(record.size)) : 0;
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : '';
      if (!id || !url) return null;
      return { id, name, type, size, url };
    })
    .filter((item): item is NonNullable<RuntimeMessage['attachments']>[number] => Boolean(item));
}
