import type { ModelRequest, RuntimeConfigState, RuntimeDynamicToolDefinition, RuntimeHookRun, RuntimeMailboxDelivery, RuntimeMemoryCitation, RuntimeMessage, RuntimeModelRequestStepSnapshot, RuntimePlanDecision, RuntimeTaskKind, RuntimeThread, RuntimeToolCall, RuntimeToolDefinition, RuntimeUsage, SendTurnInput, SendTurnResponse, SteerTurnInput } from '@setsuna-desktop/contracts';
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
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolExecutionContext, ToolExecutionEnvironment, ToolHost, ToolTurnCleanupOutcome } from '../ports/tool-host.js';
import type { UsageStore } from '../ports/usage-store.js';
import { createRuntimeToolHookRunner, type RuntimeCompactHookTrigger, type RuntimeSessionStartSource } from '../hooks/runtime-hooks.js';
import { createRuntimeContextCompactionCandidate, materializeRuntimeContextCompaction, type RuntimeContextCompactionBudget, type RuntimeContextCompactionCandidate } from './context-compaction.js';
import { RuntimeCollaborationCoordinator } from './collaboration-coordinator.js';
import { escapeSkillAttribute, neutralizeMailboxTags, neutralizePersonalizationTags, neutralizeSkillTags } from './prompt-utils.js';
import { RuntimeEventWriter } from './runtime-event-writer.js';
import { isSuccessfulRememberMemoryMessage, RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import { RuntimeModelSampler } from './runtime-model-sampler.js';
import { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import { RuntimeUserShellRunner } from './runtime-user-shell-runner.js';
import {
  compactHookTrigger,
  contextCompactionBudgetForConfig,
  HookStoppedTurnError,
  RuntimeContextCompactor,
  samplingContextWindowForMessages,
  samplingInputMessageIds,
} from './runtime-context-compactor.js';
import {
  modelFacingTools,
  normalizedMaxToolRounds,
  samplingToolRuntimes,
  shouldPublishInspectionProgressNote,
  type ToolBudget,
} from './agent-loop-tool-utils.js';
import { RuntimeToolRouter } from './tool-router.js';
import { RuntimeTurnTaskRegistry, type RuntimeTurnTask } from './turn-task-registry.js';

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
  eventWriter?: RuntimeEventWriter;
  maxToolRounds?: number;
};

const INSPECTION_PROGRESS_NOTE = '我先查看项目结构和第一批关键文件，读完后再继续收敛。\n\n';
const TURN_ABORTED_MODEL_GUIDANCE = [
  '<turn_aborted>',
  'The user interrupted the previous turn on purpose. Any running shell commands may still be running in the background. If any tools or commands were aborted, they may have partially executed.',
  '</turn_aborted>',
].join('\n');
type TurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;
type ReviewTurnInput = {
  displayText: string;
  prompt: string;
};
export type DeliverMailboxInput = {
  content: string;
  deliveryMode?: RuntimeMailboxDelivery['deliveryMode'];
  expectedTurnId?: string;
  fromAgentId?: string;
  fromThreadId?: string;
  id?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};
export type DeliverMailboxResponse = {
  accepted: true;
  queued?: boolean;
  turnId: string | null;
};
type RunTurnOptions = {
  clientId?: string;
  includeUserMessageInModel?: boolean;
  modelInput?: string;
  planDecision?: RuntimePlanDecision;
  planOnly?: boolean;
  publishUserMessage?: boolean;
  review?: { displayText: string };
  taskKind?: RuntimeTaskKind;
  userMessage?: RuntimeMessage;
};
type RuntimeSamplingStepContext = {
  conversationMessages: RuntimeMessage[];
  messages: RuntimeMessage[];
  runtimeConfig: RuntimeConfigState | null | undefined;
  snapshot: RuntimeModelRequestStepSnapshot;
  toolChoice: ModelRequest['toolChoice'];
  toolContext: RuntimeToolExecutionContext;
  toolRouter: RuntimeToolRouter | null;
  tools?: RuntimeToolDefinition[];
};

export class AgentLoop {
  private readonly turnTasks = new RuntimeTurnTaskRegistry();
  private readonly idleMailboxByThread = new Map<string, RuntimeMailboxDelivery[]>();
  private readonly sessionStartInitializedThreads = new Set<string>();
  private readonly pendingSessionStartSourcesByThread = new Map<string, RuntimeSessionStartSource[]>();
  private readonly terminalEventWrites = new Set<string>();
  private readonly eventWriter: RuntimeEventWriter;
  private readonly memory: RuntimeMemoryCoordinator;
  private readonly modelStreamEvents: RuntimeModelStreamEventPublisher;
  private readonly contextCompactor: RuntimeContextCompactor;
  private readonly collaborationCoordinator: RuntimeCollaborationCoordinator;
  private readonly toolExecutor: RuntimeToolCallExecutor;
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
    this.contextCompactor = new RuntimeContextCompactor({
      clock: options.clock,
      ids: options.ids,
      modelClient: options.modelClient,
      usageStore: options.usageStore,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      onCompacted: (threadId) => this.queueSessionStartSource(threadId, 'compact'),
      runCompactHooks: (input) => this.runCompactHooks(input),
    });
    this.collaborationCoordinator = new RuntimeCollaborationCoordinator({
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
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      publishMessage: (threadId, turnId, message) => this.publishMessage(threadId, turnId, message),
    });
    this.modelSampler = new RuntimeModelSampler({
      clock: options.clock,
      ids: options.ids,
      modelClient: options.modelClient,
      streamEvents: this.modelStreamEvents,
      toolExecutor: this.toolExecutor,
    });
    this.userShellRunner = new RuntimeUserShellRunner({
      clock: options.clock,
      ids: options.ids,
      toolHost: options.toolHost,
      appendEvent: (threadId, event) => this.appendAndPublish(threadId, event),
      cleanupTurn: (context, outcome) => this.cleanupToolHostTurn(context, outcome),
      completeMessage: (threadId, turnId, messageId) => this.completeMessage(threadId, turnId, messageId),
      publishTurnCancelledOnce: (threadId, turnId, taskKind, reason, publishOptions) =>
        this.publishTurnCancelledOnce(threadId, turnId, taskKind, reason, publishOptions),
    });
  }

  flushEvents(): Promise<void> {
    return this.eventWriter.flushAll();
  }

  async shutdown(reason = 'Desktop runtime is shutting down.', timeoutMs = 5_000): Promise<boolean> {
    this.shuttingDown = true;
    const error = new TurnCancelledError(reason);
    const tasks = this.turnTasks.cancelAll(error);
    this.options.approvalGate?.rejectPending?.(error);
    this.toolExecutor.shutdown(error);
    this.idleMailboxByThread.clear();
    await Promise.allSettled(tasks.map((task) =>
      this.publishTurnCancelledOnce(task.threadId, task.turnId, task.taskKind, reason, { marker: true }),
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
    if (active?.taskKind === 'regular' && active.acceptingSteers && !active.controller.signal.aborted) {
      // 防御 renderer/SSE 短暂不同步：active 期间的普通发送必须落回当前 turn 的 steer。
      return this.steerTurn(threadId, {
        attachments: input.attachments,
        clientId: input.clientId,
        expectedTurnId: active.turnId,
        input: input.input,
      });
    }
    const run = await this.createTurnRun(threadId, input);
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
    const run = await this.createRegenerateRun(threadId, messageId, input);
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
    const run = await this.createTurnRun(threadId, input);
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
    this.queueSessionStartSource(threadId, 'clear');
    await this.publishStoredEventsSince(threadId, beforeSeq);
    return thread;
  }

  /**
   * 启动 review turn，展示文本和模型 prompt 可以不同。
   *
   * @param threadId 目标线程 ID。
   * @param input review 的用户可见文本和模型实际 prompt。
   */
  async startReview(threadId: string, input: ReviewTurnInput): Promise<SendTurnResponse> {
    this.assertAcceptingWork();
    const run = await this.createReviewRun(threadId, input);
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
    const cancelled = this.turnTasks.cancel(threadId, turnId, new TurnCancelledError());
    if (!cancelled) return false;
    // 取消是最高优先级交互：先落终态事件释放 UI，不等待 provider/tool 主动响应 AbortSignal。
    await this.publishTurnCancelledOnce(threadId, turnId, task?.taskKind ?? 'regular', 'Turn cancelled.', { marker: true });
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

  registerAppServerDynamicTools(threadId: string, tools: RuntimeDynamicToolDefinition[], connectionId: string): void {
    this.toolExecutor.registerDynamicTools(threadId, tools, connectionId);
  }

  clearAppServerDynamicTools(threadId: string): void {
    this.toolExecutor.clearDynamicTools(threadId);
  }

  answerAppServerDynamicToolResponse(id: string | number | null | undefined, response: { result?: unknown; error?: unknown }): boolean {
    return this.toolExecutor.answerDynamicToolResponse(id, response);
  }

  private takePendingSteers(threadId: string, turnId: string): RuntimeMessage[] {
    const active = this.turnTasks.activeForThread(threadId);
    if (!active || active.turnId !== turnId || active.controller.signal.aborted) return [];
    return active.inputQueue.takeSteers();
  }

  private takePendingMailbox(threadId: string, turnId: string): RuntimeMailboxDelivery[] {
    const active = this.turnTasks.activeForThread(threadId);
    if (!active || active.turnId !== turnId || active.controller.signal.aborted) return [];
    return active.inputQueue.takeMailbox();
  }

  private queueIdleMailbox(threadId: string, input: RuntimeMailboxDelivery): void {
    const pending = this.idleMailboxByThread.get(threadId) ?? [];
    pending.push(input);
    this.idleMailboxByThread.set(threadId, pending);
  }

  private takeIdleMailbox(threadId: string): RuntimeMailboxDelivery[] {
    const pending = this.idleMailboxByThread.get(threadId);
    if (!pending?.length) return [];
    this.idleMailboxByThread.delete(threadId);
    return pending;
  }

  private async waitForPendingInputWrites(threadId: string, turnId: string): Promise<void> {
    const active = this.turnTasks.activeForThread(threadId);
    if (!active || active.turnId !== turnId || active.controller.signal.aborted) return;
    await active.inputQueue.waitForWrites();
    const current = this.turnTasks.activeForThread(threadId);
    if (current !== active || active.controller.signal.aborted) return;
  }

  private async drainPendingSteers(threadId: string, turnId: string): Promise<RuntimeMessage[]> {
    await this.waitForPendingInputWrites(threadId, turnId);
    return this.takePendingSteers(threadId, turnId);
  }

  private async drainPendingMailboxMessages(threadId: string, turnId: string): Promise<RuntimeMessage[]> {
    await this.waitForPendingInputWrites(threadId, turnId);
    return [
      ...this.takeIdleMailbox(threadId),
      ...this.takePendingMailbox(threadId, turnId),
    ].map((input) => this.mailboxMessageForModel(turnId, input));
  }

  private mailboxMessageForModel(turnId: string, input: RuntimeMailboxDelivery): RuntimeMessage {
    const fromAttribute = input.fromAgentId ? ` from_agent_id="${escapeSkillAttribute(input.fromAgentId)}"` : '';
    const fromThreadAttribute = input.fromThreadId ? ` from_thread_id="${escapeSkillAttribute(input.fromThreadId)}"` : '';
    const toAttribute = input.toAgentId ? ` to_agent_id="${escapeSkillAttribute(input.toAgentId)}"` : '';
    const modeAttribute = input.deliveryMode ? ` delivery_mode="${escapeSkillAttribute(input.deliveryMode)}"` : '';
    const triggerAttribute = input.triggerTurn ? ' trigger_turn="true"' : '';
    return {
      id: `mailbox_${input.id}`,
      turnId,
      role: 'system',
      content: `<mailbox_message id="${escapeSkillAttribute(input.id)}"${fromAttribute}${fromThreadAttribute}${toAttribute}${modeAttribute}${triggerAttribute}>\n${neutralizeMailboxTags(input.content)}\n</mailbox_message>`,
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    };
  }

  private async publishTurnAbortedMarker(threadId: string, turnId: string): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'message.created',
      createdAt,
      payload: {
        message: {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'user',
          content: TURN_ABORTED_MODEL_GUIDANCE,
          createdAt,
          status: 'complete',
          visibility: 'model',
        },
      },
    });
  }

  private async publishTurnCancelledOnce(
    threadId: string,
    turnId: string,
    taskKind: RuntimeTaskKind,
    reason: string,
    options: { marker?: boolean } = {},
  ): Promise<boolean> {
    const key = `${threadId}:${turnId}`;
    if (this.terminalEventWrites.has(key)) return false;
    this.terminalEventWrites.add(key);
    try {
      await this.eventWriter.flushThread(threadId);
      if (await this.turnHasTerminalEvent(threadId, turnId)) return false;
      if (options.marker) await this.publishTurnAbortedMarker(threadId, turnId);
      if (await this.turnHasTerminalEvent(threadId, turnId)) return false;
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.cancelled',
        createdAt: this.options.clock.now().toISOString(),
        payload: { reason, taskKind },
      });
      return true;
    } finally {
      this.terminalEventWrites.delete(key);
    }
  }

  private async turnHasTerminalEvent(threadId: string, turnId: string): Promise<boolean> {
    const events = await this.options.threadStore.listEvents(threadId, 0);
    return events.some((event) =>
      event.turnId === turnId &&
      (event.type === 'turn.cancelled' || event.type === 'turn.completed' || event.type === 'runtime.error')
    );
  }

  private stopAcceptingSteers(threadId: string, turnId: string): void {
    this.turnTasks.stopAcceptingSteers(threadId, turnId);
  }

  private async waitForFinalizingRegularTurn(threadId: string): Promise<void> {
    const active = this.turnTasks.activeForThread(threadId);
    if (active?.taskKind !== 'regular' || active.acceptingSteers || !active.done) return;
    await active.done.catch(() => undefined);
  }

  /**
   * 向正在运行的普通对话 turn 追加用户输入，不创建新的 turn。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户补充输入；expectedTurnId 用来防止补充写入过期 turn。
   */
  async steerTurn(threadId: string, input: SteerTurnInput): Promise<SendTurnResponse> {
    const text = input.input.trim();
    const attachments = normalizeAttachments(input.attachments);
    if (!text && !attachments.length) throw new Error('input must not be empty');
    await this.assertImageAttachmentsSupported(attachments);

    const active = this.turnTasks.activeForThread(threadId);
    if (!active || active.controller.signal.aborted) throw new Error('no active turn to steer');
    if (active.taskKind !== 'regular') throw new Error(`cannot steer a ${active.taskKind} turn`);
    if (active.turnId !== input.expectedTurnId) {
      throw new Error(`expected active turn id \`${input.expectedTurnId}\` but found \`${active.turnId}\``);
    }
    if (!active.acceptingSteers) throw new Error('active turn is finishing and can no longer be steered');
    active.inputQueue.beginWrite();

    try {
      const thread = await this.options.threadStore.getThread(threadId);
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      if (active.controller.signal.aborted) throw new Error('no active turn to steer');
      const message: RuntimeMessage = {
        id: this.options.ids.id('msg'),
        clientId: input.clientId,
        turnId: active.turnId,
        role: 'user',
        content: text,
        attachments,
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
      };
      // steer 先进入 transcript，保证插话立即可见；模型消费仍等当前模型段/工具链路结束后 drain。
      await this.publishMessage(threadId, active.turnId, message);
      active.inputQueue.enqueueSteer(message);
      return { accepted: true, turnId: active.turnId };
    } finally {
      active.inputQueue.settleWrite();
    }
  }

  /**
   * 向当前 active turn 投递来自子 agent/协作方的 mailbox 消息。
   *
   * @param threadId 目标线程 ID。
   * @param input mailbox 内容和可选来源。
   */
  async deliverMailboxInput(threadId: string, input: DeliverMailboxInput): Promise<DeliverMailboxResponse> {
    this.assertAcceptingWork();
    const content = input.content.trim();
    if (!content) throw new Error('mailbox content must not be empty');
    const active = this.turnTasks.activeForThread(threadId);
    if (input.expectedTurnId && (!active || active.turnId !== input.expectedTurnId)) {
      throw new Error(`expected active turn id \`${input.expectedTurnId}\` but found \`${active?.turnId ?? 'none'}\``);
    }
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const triggerTurn = input.triggerTurn === true || input.deliveryMode === 'trigger_turn';
    const delivery: RuntimeMailboxDelivery = {
      id: input.id?.trim() || this.options.ids.id('mailbox'),
      content,
      deliveryMode: input.deliveryMode ?? (triggerTurn ? 'trigger_turn' : 'queue_only'),
      fromAgentId: input.fromAgentId?.trim() || undefined,
      fromThreadId: input.fromThreadId?.trim() || undefined,
      toAgentId: input.toAgentId?.trim() || undefined,
      triggerTurn: triggerTurn || undefined,
    };

    if (active && !active.controller.signal.aborted && !turnTaskCanReceiveMailbox(active)) {
      if (input.expectedTurnId) {
        throw new Error(`active ${active.taskKind} turn cannot receive mailbox input`);
      }
    }

    if (active && !active.controller.signal.aborted && turnTaskCanReceiveMailbox(active)) {
      active.inputQueue.beginWrite();
      try {
        if (active.controller.signal.aborted) throw new Error('no active turn to deliver mailbox input');
        await this.appendAndPublish(threadId, {
          id: this.options.ids.id('event'),
          threadId,
          turnId: active.turnId,
          type: 'mailbox.delivered',
          createdAt: this.options.clock.now().toISOString(),
          payload: delivery,
        });
        active.inputQueue.enqueueMailbox(delivery);
        return { accepted: true, turnId: active.turnId };
      } finally {
        active.inputQueue.settleWrite();
      }
    }

    if (triggerTurn && !active) {
      const turnId = this.options.ids.id('turn');
      this.queueIdleMailbox(threadId, delivery);
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'mailbox.delivered',
        createdAt: this.options.clock.now().toISOString(),
        payload: delivery,
      });
      const run = this.createMailboxTriggeredRun(threadId, thread, turnId, content);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId };
    }

    this.queueIdleMailbox(threadId, delivery);
    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'mailbox.delivered',
      createdAt: this.options.clock.now().toISOString(),
      payload: delivery,
    });
    return { accepted: true, queued: true, turnId: null };
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
    const compacting = this.createCompactThreadContext(threadId, force);
    // Cancellation can reject before an HTTP/command caller gets its response
    // and attaches a handler. Keep the public promise marked as observed while
    // still returning the original rejection to the caller.
    void compacting.catch(() => undefined);
    return compacting;
  }

  private async createCompactThreadContext(threadId: string, force: boolean): Promise<RuntimeThread> {
    await this.waitForFinalizingRegularTurn(threadId);
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const candidate = createRuntimeContextCompactionCandidate({ force, messages: thread.messages });
    if (!candidate) return thread;
    const turnId = this.options.ids.id('turn');
    const run = this.turnTasks.run<RuntimeThread>({
      acceptingSteers: false,
      taskKind: 'compact',
      threadId,
      turnId,
    }, (task) => this.runCompactTask({ candidate, force, signal: task.controller.signal, thread, threadId, turnId }));
    return run.done;
  }

  private async runCompactTask({
    candidate,
    force,
    signal,
    thread,
    threadId,
    turnId,
  }: {
    candidate: RuntimeContextCompactionCandidate;
    force: boolean;
    signal: AbortSignal;
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeThread> {
    const runtimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const trigger = compactHookTrigger(force);
    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: { input: force ? '/compact' : '/compact auto', taskKind: 'compact' },
    });
    const preCompact = await this.runCompactHooks({
      eventName: 'PreCompact',
      runtimeConfig,
      signal,
      thread,
      trigger,
      turnId,
    });
    if (preCompact.shouldStop) {
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind: 'compact' },
      });
      return (await this.options.threadStore.getThread(threadId)) ?? thread;
    }
    // 手动压缩也走事件链，保证 renderer 能看到“压缩中 -> 已压缩”的完整生命周期。
    await this.publishContextCompacting(threadId, turnId, force, thread.messages);
    try {
      const summary = await this.generateContextCompactionSummary(candidate, signal);
      const result = materializeRuntimeContextCompaction({
        candidate,
        createdAt: this.options.clock.now().toISOString(),
        id: this.options.ids.id('msg'),
        source: summary.source,
        summary: summary.text,
        turnId,
      });
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'thread.context_compacted',
        createdAt: this.options.clock.now().toISOString(),
        payload: result,
      });
      await this.publishContextCompactionUsage(threadId, turnId, summary.usage);
      this.queueSessionStartSource(threadId, 'compact');
      await this.runCompactHooks({
        eventName: 'PostCompact',
        runtimeConfig,
        signal,
        thread,
        trigger,
        turnId,
      });
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind: 'compact' },
      });
      const compacted = (await this.options.threadStore.getThread(threadId)) ?? thread;
      return compacted;
    } catch (error) {
      if (isAbortError(error)) {
        await this.publishTurnCancelledOnce(
          threadId,
          turnId,
          'compact',
          error instanceof Error ? error.message : 'Turn cancelled.',
          { marker: true },
        );
        throw error;
      }
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'runtime.error',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          code: 'context_compaction_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      this.toolExecutor.clearDeferredToolRevealsForTurn(turnId);
    }
  }


  /**
   * 创建普通对话 turn 的后台执行任务，并登记取消控制器。
   *
   * @param threadId 目标线程 ID。
   * @param input 用户输入、附件和运行选项。
   */
  private async createTurnRun(threadId: string, input: SendTurnInput): Promise<{ turnId: string; done: Promise<void> }> {
    const text = input.input.trim();
    const attachments = normalizeAttachments(input.attachments);
    const planDecision = input.planDecision;
    if (!text && !attachments.length && !planDecision) throw new Error('Turn input is required.');
    await this.assertImageAttachmentsSupported(attachments);
    await this.waitForFinalizingRegularTurn(threadId);

    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const threadForRun = await this.applyPendingPlanDecision(threadId, thread, planDecisionForTurnInput(input));

    const turnId = this.options.ids.id('turn');
    // 纯计划决策 turn（无文本/附件）：accepted 用不可见执行指令驱动模型；dismissed 在 runTurn 内短路不调模型。
    const planDecisionOnly = Boolean(planDecision) && !text && !attachments.length;
    const run = this.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.runTurn(
      threadId,
      text,
      input.skillIds ?? [],
      attachments,
      threadForRun,
      turnId,
      task.controller.signal,
      {
        clientId: input.clientId,
        planOnly: input.collaborationMode === 'plan',
        taskKind: 'regular',
        planDecision: planDecisionOnly ? planDecision : undefined,
        ...(planDecisionOnly && planDecision === 'accepted'
          ? { publishUserMessage: false, includeUserMessageInModel: true, modelInput: PLAN_ACCEPT_EXECUTION_PROMPT }
          : {}),
      },
      turnThinkingOptions(input)
    ));
    return { turnId, done: run.done };
  }

  private async applyPendingPlanDecision(threadId: string, thread: RuntimeThread, decision: RuntimePlanDecision): Promise<RuntimeThread> {
    const planMessage = [...thread.messages].reverse().find((message) =>
      message.role === 'assistant' &&
      message.planMode?.mode === 'plan' &&
      message.planMode.status === 'awaiting_confirmation'
    );
    if (!planMessage) return thread;

    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId: planMessage.turnId,
      type: 'message.plan_mode_updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        messageId: planMessage.id,
        content: planMessage.content,
        planMode: { mode: 'plan', status: decision },
      },
    });
    return (await this.options.threadStore.getThread(threadId)) ?? thread;
  }

  private createMailboxTriggeredRun(threadId: string, thread: RuntimeThread, turnId: string, content: string): { turnId: string; done: Promise<void> } {
    const displayText = `Mailbox message received: ${content.slice(0, 160)}`;
    const run = this.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.runTurn(
      threadId,
      displayText,
      [],
      [],
      thread,
      turnId,
      task.controller.signal,
      {
        includeUserMessageInModel: true,
        publishUserMessage: false,
        taskKind: 'regular',
      },
      {},
    ));
    return { turnId, done: run.done };
  }

  /**
   * 创建 review turn 的后台执行任务，并把 review prompt 注入模型输入。
   *
   * @param threadId 目标线程 ID。
   * @param input review 的展示文本和模型 prompt。
   */
  private async createReviewRun(threadId: string, input: ReviewTurnInput): Promise<{ turnId: string; done: Promise<void> }> {
    const displayText = input.displayText.trim();
    const prompt = input.prompt.trim();
    if (!displayText) throw new Error('review display text is required');
    if (!prompt) throw new Error('review prompt is required');
    await this.waitForFinalizingRegularTurn(threadId);

    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const turnId = this.options.ids.id('turn');
    const run = this.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'review',
      acceptingSteers: false,
    }, (task) => this.runTurn(
      threadId,
      displayText,
      [],
      [],
      thread,
      turnId,
      task.controller.signal,
      {
        modelInput: prompt,
        review: { displayText },
        taskKind: 'review',
        userMessage: {
          id: turnId,
          turnId,
          role: 'user',
          content: displayText,
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
        },
      },
      {}
    ));
    return { turnId, done: run.done };
  }

  /**
   * 准备重新生成：更新用户消息、截断后续历史、再启动新的对话 turn。
   *
   * @param threadId 目标线程 ID。
   * @param messageId 重新生成所基于的用户消息 ID。
   * @param input 可覆盖原消息内容、skill 选择和思考参数。
   */
  private async createRegenerateRun(threadId: string, messageId: string, input: { content?: string; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string }): Promise<{ turnId: string; done: Promise<void> }> {
    await this.waitForFinalizingRegularTurn(threadId);
    await this.eventWriter.flushThread(threadId);
    const originalThread = await this.options.threadStore.getThread(threadId);
    if (!originalThread) throw new Error(`Thread not found: ${threadId}`);
    const originalMessage = originalThread.messages.find((message) => message.id === messageId);
    if (!originalMessage) throw new Error(`Message not found: ${messageId}`);
    if (originalMessage.role !== 'user') throw new Error('Only user messages can be regenerated.');

    const text = typeof input.content === 'string' ? input.content.trim() : originalMessage.content.trim();
    if (!text) throw new Error('Message content is required.');
    await this.assertImageAttachmentsSupported(normalizeAttachments(originalMessage.attachments));

    if (text !== originalMessage.content) {
      await this.options.threadStore.updateMessage(threadId, messageId, { content: text });
    }
    await this.options.threadStore.truncateMessagesAfter(threadId, messageId, false);
    await this.publishStoredEventsSince(threadId, originalThread.lastSeq);

    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const userMessage = thread.messages.find((message) => message.id === messageId);
    if (!userMessage || userMessage.role !== 'user') throw new Error(`User message not found after regeneration setup: ${messageId}`);

    const turnId = this.options.ids.id('turn');
    const run = this.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.runTurn(
      threadId,
      text,
      input.skillIds ?? [],
      normalizeAttachments(userMessage.attachments),
      thread,
      turnId,
      task.controller.signal,
      {
        userMessage,
        publishUserMessage: false,
        taskKind: 'regular',
      },
      turnThinkingOptions(input)
    ));
    return { turnId, done: run.done };
  }

  /**
   * 执行完整 agent loop：发消息、组装上下文、流式调用模型、执行工具直到得到最终回答。
   *
   * @param threadId 目标线程 ID。
   * @param text 用户可见输入文本。
   * @param skillIds 本轮显式选择的 skill ID 列表。
   * @param attachments 本轮用户输入携带的附件。
   * @param thread turn 开始前读取到的线程快照。
   * @param turnId 当前 turn ID。
   * @param signal 用于取消模型流和工具执行的信号。
   * @param options review、重生成等特殊运行选项。
   * @param thinkingOptions 透传给模型客户端的思考参数。
   */
  private async runTurn(threadId: string, text: string, skillIds: string[], attachments: NonNullable<RuntimeMessage['attachments']>, thread: RuntimeThread, turnId: string, signal: AbortSignal, options: RunTurnOptions = {}, thinkingOptions: TurnThinkingOptions = {}): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    let activeAssistantMessageId: string | null = null;
    const publishUserMessage = options.publishUserMessage !== false;
    const taskKind = options.taskKind ?? 'regular';
    const planOnly = options.planOnly === true;
    const userMessage: RuntimeMessage = options.userMessage ?? {
      id: this.options.ids.id('msg'),
      clientId: options.clientId,
      turnId,
      role: 'user',
      content: text,
      attachments,
      createdAt,
      status: 'complete',
    };
    const modelUserMessage: RuntimeMessage = options.modelInput ? { ...userMessage, content: options.modelInput } : userMessage;
    const includeUserMessageInConversation = publishUserMessage || options.includeUserMessageInModel === true;
    let runtimeConfig = await this.options.configStore?.getConfig().catch(() => null);

    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt,
      payload: { input: text, taskKind },
    });
    if (options.planDecision === 'dismissed') {
      // 放弃计划：awaiting 状态已由 applyPendingPlanDecision 标记为 dismissed，无需调用模型，直接结束 turn。
      this.stopAcceptingSteers(threadId, turnId);
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind },
      });
      return;
    }
    if (publishUserMessage) await this.publishMessage(threadId, turnId, userMessage);
    if (options.review) await this.publishReviewModeMessage(threadId, turnId, 'entered', options.review.displayText);
    const hookRunner = createRuntimeToolHookRunner(runtimeConfig);
    const userPromptHookContext = {
      threadId,
      projectId: thread.projectId,
      turnId,
      permissionProfile: runtimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: runtimeConfig?.sandboxWorkspaceWrite ?? {},
      features: runtimeConfig?.features ?? {},
      signal,
    };
    const userPromptHookEnvironment = await this.hookEnvironmentForContext(userPromptHookContext);
    const sessionStartSource = this.takeSessionStartSource(thread);
    const sessionStartHookOutcome = sessionStartSource
      ? await hookRunner?.runSessionStart({
          approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
          context: userPromptHookContext,
          environment: userPromptHookEnvironment,
          events: {
            publishHookStarted: (run) => this.toolExecutor.publishHookStarted(threadId, turnId, run),
            publishHookCompleted: (run) => this.toolExecutor.publishHookCompleted(threadId, turnId, run),
          },
          source: sessionStartSource,
        })
      : undefined;
    if (sessionStartHookOutcome?.shouldStop) {
      this.stopAcceptingSteers(threadId, turnId);
      await this.publishMessage(threadId, turnId, {
        id: this.options.ids.id('msg'),
        turnId,
        role: 'assistant',
        content: sessionStartHookOutcome.stopReason || 'SessionStart hook stopped this turn.',
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
      });
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind },
      });
      return;
    }
    const userPromptHookOutcome = await hookRunner?.runUserPromptSubmit({
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context: userPromptHookContext,
      environment: userPromptHookEnvironment,
      events: {
        publishHookStarted: (run) => this.toolExecutor.publishHookStarted(threadId, turnId, run),
        publishHookCompleted: (run) => this.toolExecutor.publishHookCompleted(threadId, turnId, run),
      },
      prompt: options.modelInput ?? text,
    });
    if (userPromptHookOutcome?.shouldStop) {
      this.stopAcceptingSteers(threadId, turnId);
      await this.publishMessage(threadId, turnId, {
        id: this.options.ids.id('msg'),
        turnId,
        role: 'assistant',
        content: userPromptHookOutcome.stopReason || 'UserPromptSubmit hook stopped this turn.',
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
      });
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind },
      });
      return;
    }
    const hookContextMessages = this.hookAdditionalContextMessages([
      ...(sessionStartHookOutcome?.additionalContexts ?? []),
      ...(userPromptHookOutcome?.additionalContexts ?? []),
    ], turnId);
    const additionalContextMessages = [
      ...hookContextMessages,
      ...(planOnly ? this.planModeContextMessages(turnId) : []),
    ];

    let usage: RuntimeUsage | undefined;
    let turnCompleted = false;
    let cleanupStatus: ToolTurnCleanupOutcome['status'] = 'completed';
    try {
      throwIfAborted(signal);
      const initialConversationMessages = await this.compactMessagesBeforeModelRequest({
        force: false,
        messages: [...thread.messages, ...(includeUserMessageInConversation ? [modelUserMessage] : [])],
        runtimeConfig,
        signal,
        thread,
        threadId,
        turnId,
      });
      let conversationMessages = initialConversationMessages;
      // review turn 展示给用户的是简短文案，发给模型的是完整 review prompt，两者在这里分流。
      runtimeConfig = runtimeConfig ?? await this.options.configStore?.getConfig().catch(() => null);
      const toolBudget: ToolBudget = {
        readFileCallCount: 0,
        inspectionCallCount: 0,
        fileMutationCallCount: 0,
      };
      let explicitMemoryUserContent = userMessage.content;
      const appendSteerMessagesToConversation = (messages: RuntimeMessage[]) => {
        if (!messages.length) return false;
        // 与 Codex turn/steer 对齐：steer 是同一 turn 的原始用户输入，
        // 不在 runtime 侧改写成额外提示词，只在下一个 sampling step 并入上下文。
        conversationMessages.push(...messages);
        const steerText = messages
          .map((message) => message.content.trim())
          .filter(Boolean)
          .join('\n\n');
        if (steerText) explicitMemoryUserContent = [explicitMemoryUserContent, steerText].filter(Boolean).join('\n\n');
        return true;
      };
      const appendMailboxMessagesToConversation = (messages: RuntimeMessage[]) => {
        if (!messages.length) return false;
        conversationMessages.push(...messages);
        return true;
      };
      let memorySavedByTool = false;
      const maxToolRounds = normalizedMaxToolRounds(this.options.maxToolRounds);
      let stopHookActive = false;

      // 一个 turn 可能包含多段 assistant：工具调用会结束当前段，把 tool 消息补回上下文后再问模型。
      for (let round = 0; round < maxToolRounds; round += 1) {
        appendMailboxMessagesToConversation(await this.drainPendingMailboxMessages(threadId, turnId));
        appendSteerMessagesToConversation(await this.drainPendingSteers(threadId, turnId));
        const stepContext = await this.captureSamplingStepContext({
          conversationMessages,
          hookContextMessages: additionalContextMessages,
          runtimeConfig,
          signal,
          skillIds,
          thread,
          threadId,
          turnId,
        });
        conversationMessages = stepContext.conversationMessages;
        runtimeConfig = stepContext.runtimeConfig;

        const sampled = await this.modelSampler.sample({
          captureProtocolUsage: true,
          forceNoTools: false,
          onAssistantStarted: (messageId) => {
            activeAssistantMessageId = messageId;
          },
          planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
          planOnly,
          signal,
          step: stepContext,
          thinkingOptions,
          threadId,
          turnId,
        });
        const {
          assistantMessage,
          assistantMessageId,
          memoryCitation: roundMemoryCitation,
          previewedToolCallIds,
          toolCalls,
        } = sampled;
        if (sampled.usage) usage = sampled.usage;
        let roundText = sampled.text;

        if (toolCalls.length) {
          throwIfAborted(signal);
          if (shouldPublishInspectionProgressNote(roundText, toolCalls)) {
            roundText += INSPECTION_PROGRESS_NOTE;
            await this.publishAssistantDelta(threadId, turnId, assistantMessageId, INSPECTION_PROGRESS_NOTE);
          }
          // 先把 toolCalls 挂到 assistant 消息上，再执行工具，UI 才能把后续 toolRuns 归到正确气泡。
          await this.completeMessage(threadId, turnId, assistantMessageId, { toolCalls, memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            toolCalls,
            status: 'complete',
          });
          const toolMessages = await this.toolExecutor.runToolCalls(toolCalls, stepContext.toolContext, stepContext.toolRouter, toolBudget, stepContext.runtimeConfig, previewedToolCallIds);
          if (toolMessages.some(isSuccessfulRememberMemoryMessage)) memorySavedByTool = true;
          conversationMessages.push(...toolMessages);
          continue;
        }

        const pendingMailboxMessages = await this.drainPendingMailboxMessages(threadId, turnId);
        const pendingSteers = await this.drainPendingSteers(threadId, turnId);
        if (pendingMailboxMessages.length || pendingSteers.length) {
          await this.completeMessage(threadId, turnId, assistantMessageId, { usage, memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          appendMailboxMessagesToConversation(pendingMailboxMessages);
          appendSteerMessagesToConversation(pendingSteers);
          usage = undefined;
          continue;
        }

        const stopHookOutcome = await this.runStopHooks({
          context: stepContext.toolContext,
          lastAssistantMessage: roundText,
          runtimeConfig,
          stopHookActive,
        });
        if (stopHookOutcome.shouldBlock && stopHookOutcome.blockReason) {
          await this.completeMessage(threadId, turnId, assistantMessageId, { memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          conversationMessages.push(...this.stopHookContinuationMessages(stopHookOutcome.blockReason, turnId));
          stopHookActive = true;
          usage = undefined;
          continue;
        }

        this.stopAcceptingSteers(threadId, turnId);
        await this.finishAssistantTurn(threadId, turnId, assistantMessageId, usage, {
          explicitMemory: {
            alreadySaved: memorySavedByTool,
            config: runtimeConfig,
            projectId: thread.projectId,
            userContent: explicitMemoryUserContent,
          },
          memoryCitation: roundMemoryCitation,
          content: roundText,
          planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
          review: options.review ? roundText : undefined,
          taskKind,
        });
        activeAssistantMessageId = null;
        turnCompleted = true;
        break;
      }

      if (!turnCompleted) {
        // 达到工具轮次上限后禁用 toolChoice 再要一次最终回答，避免无限工具循环。
        appendMailboxMessagesToConversation(await this.drainPendingMailboxMessages(threadId, turnId));
        appendSteerMessagesToConversation(await this.drainPendingSteers(threadId, turnId));
        const finalStepContext = await this.captureSamplingStepContext({
          conversationMessages,
          hookContextMessages: additionalContextMessages,
          runtimeConfig,
          signal,
          skillIds,
          thread,
          threadId,
          turnId,
        });
        conversationMessages = finalStepContext.conversationMessages;
        runtimeConfig = finalStepContext.runtimeConfig;
        this.stopAcceptingSteers(threadId, turnId);
        const sampled = await this.modelSampler.sample({
          captureProtocolUsage: false,
          forceNoTools: true,
          onAssistantStarted: (messageId) => {
            activeAssistantMessageId = messageId;
          },
          planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
          planOnly,
          signal,
          step: finalStepContext,
          thinkingOptions,
          threadId,
          turnId,
        });
        const assistantMessageId = sampled.assistantMessageId;
        const finalMemoryCitation = sampled.memoryCitation;
        if (sampled.usage) usage = sampled.usage;
        let finalText = sampled.text;

        if (!finalText.trim()) {
          const fallbackText = `已经连续执行了 ${maxToolRounds} 轮工具调用，我先停止继续调用工具并保留当前结果。可以继续让我接着处理剩余部分。`;
          await this.appendAndPublish(threadId, {
            id: this.options.ids.id('event'),
            threadId,
            turnId,
            type: 'message.delta',
            createdAt: this.options.clock.now().toISOString(),
            payload: { messageId: assistantMessageId, text: fallbackText },
          });
          finalText = fallbackText;
        }

        await this.finishAssistantTurn(threadId, turnId, assistantMessageId, usage, {
          explicitMemory: {
            alreadySaved: memorySavedByTool,
            config: runtimeConfig,
            projectId: thread.projectId,
            userContent: explicitMemoryUserContent,
          },
          memoryCitation: finalMemoryCitation,
          content: finalText,
          planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
          review: options.review ? finalText : undefined,
          taskKind,
        });
        activeAssistantMessageId = null;
      }
    } catch (error) {
      if (error instanceof HookStoppedTurnError) {
        if (activeAssistantMessageId) {
          await this.completeMessage(threadId, turnId, activeAssistantMessageId);
        }
        this.stopAcceptingSteers(threadId, turnId);
        await this.publishMessage(threadId, turnId, {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'assistant',
          content: error.message,
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
        });
        await this.appendAndPublish(threadId, {
          id: this.options.ids.id('event'),
          threadId,
          turnId,
          type: 'turn.completed',
          createdAt: this.options.clock.now().toISOString(),
          payload: { taskKind },
        });
        return;
      }
      if (isAbortError(error)) {
        cleanupStatus = 'cancelled';
        if (activeAssistantMessageId) {
          await this.completeMessage(threadId, turnId, activeAssistantMessageId);
        }
        await this.publishTurnCancelledOnce(
          threadId,
          turnId,
          taskKind,
          error instanceof Error ? error.message : 'Turn cancelled.',
          { marker: true },
        );
        return;
      }
      cleanupStatus = 'failed';
      await this.appendAndPublish(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'runtime.error',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          code: 'turn_failed',
        },
      });
      throw error;
    } finally {
      await this.cleanupToolHostTurn({
        threadId,
        projectId: thread.projectId,
        turnId,
      }, { status: cleanupStatus });
    }
  }

  private async cleanupToolHostTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void> {
    const cleanupTurn = this.options.toolHost?.cleanupTurn;
    if (!cleanupTurn || !context.turnId) return;
    try {
      await cleanupTurn.call(this.options.toolHost, context, outcome);
    } catch (error) {
      await this.appendAndPublish(context.threadId, {
        id: this.options.ids.id('event'),
        threadId: context.threadId,
        turnId: context.turnId,
        type: 'runtime.error',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          code: 'tool_cleanup_failed',
        },
      }).catch(() => undefined);
    }
  }

  /**
   * 校验当前模型是否允许图片附件输入。
   *
   * @param attachments 用户输入归一化后的附件列表。
   */
  private async assertImageAttachmentsSupported(attachments: NonNullable<RuntimeMessage['attachments']>): Promise<void> {
    if (!attachments.length || !attachments.some((attachment) => attachment.type.startsWith('image/'))) return;
    const activeProvider = await this.options.configStore?.getActiveProviderConfig().catch(() => null);
    if (!activeProvider || activeProvider.activeModel?.supportsImages) return;
    throw new Error('当前模型未启用图片输入。');
  }

  private queueSessionStartSource(threadId: string, source: RuntimeSessionStartSource): void {
    const pending = this.pendingSessionStartSourcesByThread.get(threadId) ?? [];
    pending.push(source);
    this.pendingSessionStartSourcesByThread.set(threadId, pending);
  }

  private takeSessionStartSource(thread: RuntimeThread): RuntimeSessionStartSource | null {
    const pending = this.pendingSessionStartSourcesByThread.get(thread.id);
    const next = pending?.shift();
    if (pending && !pending.length) this.pendingSessionStartSourcesByThread.delete(thread.id);
    if (next) {
      this.sessionStartInitializedThreads.add(thread.id);
      return next;
    }
    if (this.sessionStartInitializedThreads.has(thread.id)) return null;
    this.sessionStartInitializedThreads.add(thread.id);
    if (thread.forkedFromId) return 'startup';
    return thread.messages.length ? 'resume' : 'startup';
  }

  private async hookEnvironmentForContext(context: ToolExecutionContext & { turnId: string }): Promise<ToolExecutionEnvironment> {
    const environment = this.options.toolHost?.environmentForToolContext
      ? await Promise.resolve(this.options.toolHost.environmentForToolContext(context)).catch(() => null)
      : null;
    return environment ?? {
      id: context.projectId ?? context.threadId,
      cwd: process.cwd(),
    };
  }

  private hookAdditionalContextMessages(contexts: string[], turnId: string): RuntimeMessage[] {
    const text = contexts.map((context) => context.trim()).filter(Boolean).join('\n\n');
    if (!text) return [];
    return [{
      id: this.options.ids.id('msg'),
      turnId,
      role: 'system',
      content: [
        '<hook_additional_context>',
        text,
        '</hook_additional_context>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  private planModeContextMessages(turnId: string): RuntimeMessage[] {
    return [{
      id: 'desktop_plan_mode',
      turnId,
      role: 'system',
      content: [
        '<plan_mode>',
        'Plan mode is active. Produce a concise implementation plan or review plan only.',
        'Do not call tools, edit files, run commands, or claim completed work in this turn.',
        'End by waiting for the user to confirm before execution.',
        '</plan_mode>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  private stopHookContinuationMessages(reason: string, turnId: string): RuntimeMessage[] {
    const text = reason.trim();
    if (!text) return [];
    return [{
      id: this.options.ids.id('msg'),
      turnId,
      role: 'system',
      content: [
        '<hook_stop_continuation>',
        text,
        '</hook_stop_continuation>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  private async runCompactHooks({
    eventName,
    runtimeConfig,
    signal,
    thread,
    trigger,
    turnId,
  }: {
    eventName: 'PreCompact' | 'PostCompact';
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal?: AbortSignal;
    thread: RuntimeThread;
    trigger: RuntimeCompactHookTrigger;
    turnId: string;
  }) {
    const runner = createRuntimeToolHookRunner(runtimeConfig);
    if (!runner) return { shouldStop: false };
    const context = {
      threadId: thread.id,
      projectId: thread.projectId,
      turnId,
      permissionProfile: runtimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: runtimeConfig?.sandboxWorkspaceWrite ?? {},
      features: runtimeConfig?.features ?? {},
      signal,
    };
    const environment = await this.hookEnvironmentForContext(context);
    const input = {
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context,
      environment,
      events: {
        publishHookStarted: (run: RuntimeHookRun) => this.toolExecutor.publishHookStarted(thread.id, turnId, run),
        publishHookCompleted: (run: RuntimeHookRun) => this.toolExecutor.publishHookCompleted(thread.id, turnId, run),
      },
      trigger,
    };
    return eventName === 'PreCompact' ? runner.runPreCompact(input) : runner.runPostCompact(input);
  }

  private async runStopHooks({
    context,
    lastAssistantMessage,
    runtimeConfig,
    stopHookActive,
  }: {
    context: RuntimeToolExecutionContext;
    lastAssistantMessage: string;
    runtimeConfig: RuntimeConfigState | null | undefined;
    stopHookActive: boolean;
  }) {
    const runner = createRuntimeToolHookRunner(runtimeConfig);
    if (!runner) return { shouldBlock: false, shouldStop: false };
    const environment = await this.hookEnvironmentForContext(context);
    return runner.runStop({
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context,
      environment,
      events: {
        publishHookStarted: (run) => this.toolExecutor.publishHookStarted(context.threadId, context.turnId, run),
        publishHookCompleted: (run) => this.toolExecutor.publishHookCompleted(context.threadId, context.turnId, run),
      },
      lastAssistantMessage,
      stopHookActive,
    });
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
  private async finishAssistantTurn(
    threadId: string,
    turnId: string,
    messageId: string,
    usage?: RuntimeUsage,
    options: {
      explicitMemory?: {
        alreadySaved: boolean;
        config: RuntimeConfigState | null | undefined;
        projectId?: string;
        userContent: string;
      };
      memoryCitation?: RuntimeMemoryCitation;
      content?: string;
      planMode?: RuntimeMessage['planMode'];
      review?: string;
      taskKind?: RuntimeTaskKind;
    } = {}
  ): Promise<void> {
    if (usage) {
      // usage 只在模型返回时记录；工具失败或取消不会伪造 token 消耗。
      await this.options.usageStore?.recordUsage({
        threadId,
        turnId,
        createdAt: this.options.clock.now().toISOString(),
        ...usage,
      });
    }
    await this.completeMessage(threadId, turnId, messageId, { content: options.content, usage, memoryCitation: options.memoryCitation, planMode: options.planMode });
    if (options.review !== undefined) {
      await this.publishReviewModeMessage(threadId, turnId, 'exited', options.review.trim() || 'Review completed.');
    }
    await this.memory.rememberExplicitUserMemory(threadId, turnId, options.explicitMemory);
    await this.appendAndPublish(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.completed',
      createdAt: this.options.clock.now().toISOString(),
      payload: { usage, taskKind: options.taskKind },
    });
    // 被动记忆失败不影响本轮回答完成，避免辅助功能阻塞主对话。
    await this.memory.extractPassiveMemoriesForTurn(threadId, turnId).catch(() => undefined);
  }

  /**
   * 写入 review 模式进入/退出标记，供 transcript 展示使用。
   *
   * @param threadId 目标线程 ID。
   * @param turnId review turn ID。
   * @param kind 标记 review 进入或退出。
   * @param review 展示给用户的 review 文案。
   */
  private async publishReviewModeMessage(threadId: string, turnId: string, kind: NonNullable<RuntimeMessage['reviewMode']>['kind'], review: string): Promise<void> {
    // reviewMode 是 transcript-only 系统消息，只控制 UI 展示，不进入下一轮模型上下文。
    await this.publishMessage(threadId, turnId, {
      id: this.options.ids.id('msg'),
      turnId,
      role: 'system',
      content: '',
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'transcript',
      reviewMode: { kind, review },
    });
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

  /**
   * 在模型请求前必要时压缩消息，并返回真正进入 prompt 的消息窗口。
   *
   * @param force 是否强制压缩。
   * @param messages 候选消息列表。
   * @param signal 当前 turn 的取消信号。
   * @param threadId 目标线程 ID。
   * @param turnId 当前 turn ID。
   */
  private compactMessagesBeforeModelRequest(input: { force: boolean; messages: RuntimeMessage[]; runtimeConfig: RuntimeConfigState | null | undefined; signal: AbortSignal; thread: RuntimeThread; threadId: string; turnId: string }): Promise<RuntimeMessage[]> {
    return this.contextCompactor.compactMessagesBeforeModelRequest(input);
  }

  private generateContextCompactionSummary(candidate: RuntimeContextCompactionCandidate, signal?: AbortSignal): Promise<{ source: 'local' | 'remote'; text: string; usage?: RuntimeUsage }> {
    return this.contextCompactor.generateContextCompactionSummary(candidate, signal);
  }

  private publishContextCompactionUsage(threadId: string, turnId: string, usage: RuntimeUsage | undefined): Promise<void> {
    return this.contextCompactor.publishContextCompactionUsage(threadId, turnId, usage);
  }

  private publishContextCompacting(threadId: string, turnId: string | undefined, force: boolean, messages: RuntimeMessage[], budget?: RuntimeContextCompactionBudget): Promise<void> {
    return this.contextCompactor.publishContextCompacting(threadId, turnId, force, messages, budget);
  }
  private async captureSamplingStepContext({
    conversationMessages,
    hookContextMessages,
    runtimeConfig,
    signal,
    skillIds,
    thread,
    threadId,
    turnId,
  }: {
    conversationMessages: RuntimeMessage[];
    hookContextMessages: RuntimeMessage[];
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal: AbortSignal;
    skillIds: string[];
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeSamplingStepContext> {
    const latestRuntimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const stepRuntimeConfig = latestRuntimeConfig ?? runtimeConfig ?? null;
    const compactedConversationMessages = await this.compactMessagesBeforeModelRequest({
      force: false,
      messages: conversationMessages,
      runtimeConfig: stepRuntimeConfig,
      signal,
      thread,
      threadId,
      turnId,
    });
    const toolContext: RuntimeToolExecutionContext = {
      threadId,
      projectId: thread.projectId,
      turnId,
      permissionProfile: stepRuntimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: stepRuntimeConfig?.sandboxWorkspaceWrite ?? {},
      features: stepRuntimeConfig?.features ?? {},
      signal,
    };
    const dynamicTools = this.toolExecutor.dynamicToolsForThread(threadId);
    const revealedDeferredToolNames = this.toolExecutor.revealedDeferredToolNamesForTurn(turnId);
    const toolRouter = this.options.toolHost
      ? await RuntimeToolRouter.create({
          toolHost: this.options.toolHost,
          orchestrator: this.toolExecutor.toolOrchestratorFor(toolContext, stepRuntimeConfig),
          context: toolContext,
          approvalPolicy: stepRuntimeConfig?.approvalPolicy ?? 'on-request',
          additionalDeferredTools: dynamicTools?.filter((tool) => tool.deferLoading),
          revealedDeferredToolNames,
          revealDeferredTools: (names) => this.toolExecutor.revealDeferredToolsForTurn(turnId, names),
          strictApprovalRequiresSerial: Boolean(this.options.approvalGate && (stepRuntimeConfig?.approvalPolicy ?? 'on-request') === 'strict'),
        })
      : null;
    const tools = modelFacingTools(toolRouter?.tools, stepRuntimeConfig, dynamicTools, revealedDeferredToolNames);
    const advertisedToolNames = tools?.map((tool) => tool.name) ?? [];
    const toolRuntimes = await samplingToolRuntimes(tools ?? [], toolRouter, dynamicTools, stepRuntimeConfig);
    const skillContext = await this.skillContextMessages(skillIds);
    // 模型上下文按“长期规则 -> 临时能力 -> 对话历史”排序，当前用户 turn 保持离模型最近。
    const messages: RuntimeMessage[] = [
      ...this.personalizationContextMessages(stepRuntimeConfig),
      ...(await this.memory.contextMessages(thread.projectId, stepRuntimeConfig)),
      ...(await this.toolSystemPromptMessages(toolContext, toolRouter)),
      ...skillContext.messages,
      ...hookContextMessages,
      ...compactedConversationMessages,
    ];
    const toolChoice = tools?.length ? (await toolRouter?.toolChoice(messages) ?? 'auto') : undefined;
    const snapshotThread = await this.options.threadStore.getThread(threadId).catch(() => null);
    const mcpServerKeys = await this.mcpServerKeysForSnapshot();
    const snapshot: RuntimeModelRequestStepSnapshot = {
      threadId,
      turnId,
      threadLastSeq: snapshotThread?.lastSeq ?? thread.lastSeq,
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
      conversationMessageIds: compactedConversationMessages.map((message) => message.id),
      messageIds: messages.map((message) => message.id),
      inputMessageIds: samplingInputMessageIds(messages, turnId),
      toolNames: advertisedToolNames,
      advertisedToolNames,
      deferredToolNames: toolRouter?.deferredToolNames() ?? [],
      routerToolNames: toolRouter?.routerOwnedToolNames() ?? [],
      toolRuntimes,
      ...(toolChoice ? { toolChoice } : {}),
      toolEnvironment: toolRouter?.environment ?? null,
      selectedSkills: skillContext.selectedSkills,
      mcpServerKeys,
      mcpServerCount: mcpServerKeys.length,
      permissionProfile: toolContext.permissionProfile,
      ...(toolContext.sandboxWorkspaceWrite ? { sandboxWorkspaceWrite: toolContext.sandboxWorkspaceWrite } : {}),
      contextWindow: samplingContextWindowForMessages(modelRequestMessages(messages), contextCompactionBudgetForConfig(stepRuntimeConfig)),
      featureKeys: Object.keys(toolContext.features ?? {}).sort(),
      worldState: {
        ...(stepRuntimeConfig?.activeProviderId ? { activeProviderId: stepRuntimeConfig.activeProviderId } : {}),
        ...(stepRuntimeConfig?.configPath ? { configPath: stepRuntimeConfig.configPath } : {}),
        ...(stepRuntimeConfig?.dataPath ? { dataPath: stepRuntimeConfig.dataPath } : {}),
        ...(stepRuntimeConfig ? { memoryEnabled: stepRuntimeConfig.memoryEnabled } : {}),
        ...(stepRuntimeConfig?.storagePath ? { storagePath: stepRuntimeConfig.storagePath } : {}),
        threadMessageCount: snapshotThread?.messageCount ?? thread.messageCount,
        threadUpdatedAt: snapshotThread?.updatedAt ?? thread.updatedAt,
      },
    };
    return {
      conversationMessages: compactedConversationMessages,
      messages,
      runtimeConfig: stepRuntimeConfig,
      snapshot,
      toolChoice,
      toolContext,
      toolRouter,
      tools,
    };
  }

  private async mcpServerKeysForSnapshot(): Promise<string[]> {
    const servers = await this.options.mcpStore?.listServerInputs().catch(() => []);
    if (!servers?.length) return [];
    return servers
      .filter((server) => server.enabled !== false)
      .map((server) => server.key.trim())
      .filter(Boolean)
      .sort();
  }

  /**
   * 根据本轮选择的 skill 构造注入模型的 system 消息。
   *
   * @param skillIds 本轮用户显式选择的 skill ID 列表。
   */
  private async skillContextMessages(skillIds: string[] = []): Promise<{ messages: RuntimeMessage[]; selectedSkills: RuntimeModelRequestStepSnapshot['selectedSkills'] }> {
    const injections = await this.options.skillRegistry?.selectedSkillInjections(skillIds);
    if (!injections?.length) return { messages: [], selectedSkills: [] };
    // Skill 内容包在自定义标签里，并转义闭合标签，避免 skill 文本提前截断注入块。
    const messages = injections.map((skill) => ({
      id: `skill_${skill.id}`,
      role: 'system' as const,
      content: `<skill name="${escapeSkillAttribute(skill.name)}" id="${escapeSkillAttribute(skill.id)}">\n${neutralizeSkillTags(skill.content)}\n</skill>`,
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete' as const,
    }));
    return {
      messages,
      selectedSkills: injections.map((skill) => ({ id: skill.id, name: skill.name })),
    };
  }

  /**
   * 从 ToolHost 读取本地工具规则，并封装为 system prompt。
   *
   * @param context 当前工具执行上下文。
   */
  private async toolSystemPromptMessages(context: RuntimeToolExecutionContext, toolRouter?: RuntimeToolRouter | null) {
    const prompt = toolRouter ? await toolRouter.systemPrompt() : await this.options.toolHost?.systemPrompt?.(context);
    if (typeof prompt !== 'string' || !prompt.trim()) return [];
    return [
      {
        id: 'desktop_local_tool_rules',
        role: 'system' as const,
        content: prompt.trim(),
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete' as const,
      },
    ];
  }

  /**
   * 根据用户配置构造个性化 system prompt。
   *
   * @param config 当前 runtime 配置；缺失时不注入个性化。
   */
  private personalizationContextMessages(config: RuntimeConfigState | null | undefined) {
    if (!config) return [];
    const globalPrompt = config.globalPrompt.trim();
    const styleInstruction =
      config.setsunaStyle === 'daily'
        ? 'Setsuna style: use a more everyday, conversational tone. Be warm, lightweight, and practical; do not over-index on code unless the user asks for development work.'
        : 'Setsuna style: use a development-oriented tone. Prioritize concrete engineering judgment, repo evidence, implementation steps, and validation when code changes are involved.';
    return [
      {
        id: 'desktop_personalization',
        role: 'system' as const,
        content: ['Desktop personalization:', 'Apply these user preferences when they do not conflict with higher-priority instructions, desktop runtime rules, or the current user request.', styleInstruction, globalPrompt ? `User global prompt:\n${neutralizePersonalizationTags(globalPrompt)}` : ''].filter(Boolean).join('\n'),
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete' as const,
      },
    ];
  }

  /**
   * 执行模型返回的一组工具调用，并把每个工具结果转换成 tool 消息回填模型上下文。
   *
   * @param toolCalls 模型本轮返回的工具调用列表。
   * @param context 当前工具执行上下文。
   * @param toolRouter 当前 sampling step 捕获的工具路由器。
   * @param toolBudget 本轮累计工具预算计数器。
   * @param previewedToolCallIds 已通过 delta 预览发布过的工具调用 ID。
   */
}

/**
 * 解析模型返回的工具参数字符串。
 *
 * @param value 模型输出的 arguments 字符串。
 */

class TurnCancelledError extends Error {
  constructor(message = 'Turn cancelled.') {
    super(message);
    this.name = 'AbortError';
  }
}


function turnTaskCanReceiveMailbox(task: RuntimeTurnTask): boolean {
  return task.taskKind === 'regular' && task.acceptingSteers && !task.controller.signal.aborted;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (!signal.aborted) return;
  throw abortReason(signal);
}

/**
 * 把 AbortSignal.reason 归一化成 Error。
 *
 * @param signal 已触发或可能触发的取消信号。
 */
function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const reason = typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.';
  const error = new Error(reason);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
}


/**
 * 将消息列表格式化为上下文压缩模型可读的历史文本。
 *
 * @param messages 候选历史消息。
 */

/**
 * 取出某个 turn 中可用于被动记忆抽取的用户/助手消息。
 *
 * @param messages 当前线程消息列表。
 * @param turnId 需要抽取的 turn ID。
 */
function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}

/**
 * 从压缩模型输出中提取最终摘要文本。
 *
 * @param value 压缩模型原始输出。
 */

const PLAN_ACCEPT_EXECUTION_PROMPT = '请按照上述已确认的计划开始执行。';

function planDecisionForTurnInput(input: SendTurnInput): RuntimePlanDecision {
  if (input.planDecision) return input.planDecision;
  return input.collaborationMode === 'plan' ? 'dismissed' : 'accepted';
}

function awaitingPlanConfirmationNotice(): NonNullable<RuntimeMessage['planMode']> {
  return {
    mode: 'plan',
    status: 'awaiting_confirmation',
  };
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

/**
 * 从 API 输入中提取模型思考选项。
 *
 * @param input 含 thinking 和 thinkingEffort 的请求片段。
 */
function turnThinkingOptions(input: { thinking?: boolean; thinkingEffort?: string }): TurnThinkingOptions {
  const thinking = input.thinking === true;
  const reasoningEffort = typeof input.thinkingEffort === 'string' && input.thinkingEffort.trim() ? input.thinkingEffort.trim() : undefined;
  return {
    thinking,
    ...(thinking && reasoningEffort ? { reasoningEffort } : {}),
  };
}
