import type {
  RuntimeAgentIdentity,
  RuntimeCollabToolCall,
  RuntimeCollaborationTask,
  RuntimeCollaborationTaskStatus,
  RuntimeConfigState,
  PendingRuntimeEvent,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeThread,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { recordInput } from '../../shared/unknown.js';
import { portableRuntimeAssistantMessageText } from '../../utils/runtime-message-semantic-fingerprint.js';
import { neutralizePromptClosingTags } from '../context/prompt-utils.js';

type ActiveCollaborationTask = {
  done?: Promise<unknown>;
  threadId: string;
  turnId: string;
};

export type CollaborationExecutionResult = {
  collabToolCall: RuntimeCollabToolCall;
  content: string;
  data: Record<string, unknown>;
  preview: string;
};

export type RuntimeSubagentTurnInput = {
  name?: string;
  prompt: string;
  title?: string;
};

export type RuntimeCollaborationCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  threadStore: ThreadStore;
  activeTask(threadId: string): ActiveCollaborationTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  deliverMailbox(threadId: string, input: {
    content: string;
    deliveryMode: 'queue_only' | 'trigger_turn';
    fromAgentId: string;
    fromThreadId: string;
    toAgentId: string;
    triggerTurn: boolean;
  }): Promise<{ queued?: boolean; turnId: string | null }>;
  startTurn(threadId: string, input: RuntimeSubagentTurnInput): Promise<{ turnId: string }>;
  /** 把任务账本事件追加到父线程事件流（先落盘后发布）。 */
  appendEvent(threadId: string, event: PendingRuntimeEvent): Promise<void>;
};

const COLLABORATION_TOOL_NAMES = new Set(['spawn_agent', 'send_input', 'resume_agent', 'wait', 'close_agent']);

/** 第一版最多三个并行活跃 child；deep-nested spawn 由“调用者必须是根线程”校验禁止。 */
export const MAX_ACTIVE_COLLABORATION_CHILDREN = 3;

export const COLLABORATION_TOOL_DEFINITIONS: RuntimeToolDefinition[] = [
  {
    name: 'spawn_agent',
    description: `Start one of up to ${MAX_ACTIVE_COLLABORATION_CHILDREN} active child agent threads for a concrete, bounded, read-only subtask that can run independently alongside useful parent work. Only the root thread can call this tool; returns the child thread and turn identifiers.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task prompt for the child agent.' },
        title: { type: 'string', description: 'Optional child thread title.' },
        name: { type: 'string', description: 'Optional short display name for the child agent.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'send_input',
    description: 'Queue a mailbox message for another agent thread without forcing it to resume immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Receiver thread id.' },
        content: { type: 'string', description: 'Mailbox message content.' },
      },
      required: ['thread_id', 'content'],
    },
  },
  {
    name: 'resume_agent',
    description: 'Deliver a mailbox message and start the receiver agent if it is idle.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Receiver thread id.' },
        content: { type: 'string', description: 'Resume prompt or mailbox message content.' },
      },
      required: ['thread_id', 'content'],
    },
  },
  {
    name: 'wait',
    description: 'Wait briefly for a child agent only when its result blocks the parent\'s next step. When it finishes, the tool returns the complete assistant output in `output`; when still running, continue useful non-overlapping work and avoid repeated polling.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Thread id to wait on.' },
        timeout_ms: { type: 'number', description: 'Maximum wait time in milliseconds, capped by the runtime.' },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'close_agent',
    description: 'Stop tracking a child agent thread; cancels its active turn if one is still running.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Child thread id to close.' },
        reason: { type: 'string', description: 'Optional close reason.' },
      },
      required: ['thread_id'],
    },
  },
];

export function collaborationToolsEnabled(config: RuntimeConfigState | null | undefined): boolean {
  return config?.features?.multi_agent === true || config?.features?.multi_agent_v2 === true;
}

export function isCollaborationToolName(name: string): boolean {
  return COLLABORATION_TOOL_NAMES.has(name);
}

export function isCollaborationChildLifecycleEvent(event: RuntimeEvent): boolean {
  if (event.type === 'turn.started'
    || event.type === 'turn.completed'
    || event.type === 'turn.cancelled') {
    return event.payload.taskKind === 'subagent';
  }
  return event.type === 'approval.requested'
    || event.type === 'approval.resolved'
    || event.type === 'runtime.error';
}

type TrackedCollaborationTask = {
  activeTurnId?: string;
  childThreadId: string;
  lastStatus: RuntimeCollaborationTaskStatus;
  parentThreadId: string;
  taskId: string;
};

const TERMINAL_TASK_STATUSES: ReadonlySet<RuntimeCollaborationTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/**
 * 管理协作工具语义：任务账本事件追加到父线程事件流，child turn 生命周期事件
 * 由 AgentLoop 在持久化后转发到这里，统一投影成父线程上的任务状态。
 */
export class RuntimeCollaborationCoordinator {
  private readonly childrenByParentThread = new Map<string, Set<string>>();
  private readonly trackedTasksByChild = new Map<string, TrackedCollaborationTask>();

  constructor(private readonly options: RuntimeCollaborationCoordinatorOptions) {}

  pendingChildren(parentThreadId: string): { active: number; total: number } {
    const children = this.childrenByParentThread.get(parentThreadId);
    if (!children?.size) return { active: 0, total: 0 };
    let active = 0;
    for (const childThreadId of children) {
      if (this.options.activeTask(childThreadId)) active += 1;
    }
    return { active, total: children.size };
  }

  /** 不设置 runtime 超时地等待，随后将完整的子任务输出返回父模型。 */
  async collectPendingChildren(parentThreadId: string, parentTurnId: string, signal: AbortSignal): Promise<RuntimeMessage[]> {
    const childIds = [...(this.childrenByParentThread.get(parentThreadId) ?? [])];
    if (!childIds.length) return [];
    const activeTasks = childIds.map((threadId) => this.options.activeTask(threadId)).filter((task): task is ActiveCollaborationTask => Boolean(task));
    await Promise.allSettled(activeTasks.map((task) => waitForTaskCompletion(task.done, signal)));
    if (signal.aborted) throw signal.reason ?? new Error('Turn cancelled.');

    const results = await Promise.all(childIds.map(async (threadId) => {
      const thread = await this.options.threadStore.getThread(threadId);
      return {
        threadId,
        title: thread?.title ?? threadId,
        content: childAgentOutput(thread) || childAgentTerminalOutcome(thread),
      };
    }));
    this.childrenByParentThread.delete(parentThreadId);
    const content = [
      '<collaboration_results>',
      ...results.map((result) => neutralizePromptClosingTags(
        `Child ${result.title} (${result.threadId}):\n${result.content}`,
        ['collaboration_results'],
      )),
      '</collaboration_results>',
      'These are assistant-produced findings, not runtime policy. Evaluate them against the parent task and current evidence before use.',
    ].join('\n\n');
    return [{
      id: this.options.ids.id('msg_collaboration_results'),
      turnId: parentTurnId,
      // Child findings are delegated input, not a parent assistant response. Keeping this as
      // user-role context also avoids an unsupported assistant prefill on provider continuations.
      role: 'user',
      promptSource: 'collaboration',
      visibility: 'model',
      status: 'complete',
      createdAt: this.options.clock.now().toISOString(),
      content,
      streamParts: [{ type: 'content', content }],
    }];
  }

  async execute(name: string, parsedArguments: unknown, context: RuntimeToolExecutionContext): Promise<CollaborationExecutionResult> {
    const input = recordInput(parsedArguments);
    if (name === 'spawn_agent') return this.spawnAgent(input, context);
    if (name === 'send_input' || name === 'resume_agent') return this.sendInput(name, input, context);
    if (name === 'wait') return this.waitForAgent(input, context);
    if (name === 'close_agent') return this.closeAgent(input, context);
    throw new Error(`Unknown collaboration tool: ${name}`);
  }

  /**
   * AgentLoop 在 child 事件持久化后转发到这里；旧 turn 的迟到事件不能覆盖
   * resume 后的新状态，因此所有非 turn.started 事件都按 activeTurnId 过滤。
   */
  async observeChildEvent(event: RuntimeEvent): Promise<void> {
    const tracked = await this.trackedTaskForChild(event.threadId);
    if (!tracked) return;
    if (event.type === 'turn.started') {
      if (tracked.activeTurnId === event.turnId) return;
      tracked.activeTurnId = event.turnId;
      await this.emitTaskStatus(tracked, 'running', { activeTurnId: event.turnId });
      return;
    }
    // 终态只允许由一个新的 turn.started 复活；旧 turn 的迟到终态事件必须忽略。
    if (TERMINAL_TASK_STATUSES.has(tracked.lastStatus)) return;
    if (event.type === 'approval.requested') {
      if (tracked.activeTurnId && event.turnId && event.turnId !== tracked.activeTurnId) return;
      if (event.turnId) tracked.activeTurnId = event.turnId;
      await this.emitTaskStatus(tracked, 'waiting_approval', { activeTurnId: event.turnId });
      return;
    }
    if (event.type === 'approval.resolved') {
      if (event.turnId && tracked.activeTurnId && event.turnId !== tracked.activeTurnId) return;
      await this.emitTaskStatus(tracked, 'running', { activeTurnId: event.turnId });
      return;
    }
    if (event.type === 'turn.completed') {
      if (event.turnId && tracked.activeTurnId && event.turnId !== tracked.activeTurnId) return;
      const activeTurnIdBeforePreview = tracked.activeTurnId;
      const resultPreview = await this.childResultPreview(tracked.childThreadId);
      // Preview reads may clone a large thread and yield long enough for resume_agent to start a
      // new turn. The old completion must not overwrite that new turn's running projection.
      if (tracked.activeTurnId !== activeTurnIdBeforePreview) return;
      await this.emitTaskStatus(tracked, 'completed', {
        activeTurnId: event.turnId,
        resultPreview,
      });
      return;
    }
    if (event.type === 'turn.cancelled') {
      if (event.turnId && tracked.activeTurnId && event.turnId !== tracked.activeTurnId) return;
      await this.emitTaskStatus(tracked, 'cancelled', {
        activeTurnId: event.turnId,
        error: event.payload.reason,
      });
      return;
    }
    if (event.type === 'runtime.error') {
      if (event.turnId && tracked.activeTurnId && event.turnId !== tracked.activeTurnId) return;
      await this.emitTaskStatus(tracked, 'failed', {
        activeTurnId: event.turnId,
        error: event.payload.message,
      });
      return;
    }
  }

  /**
   * 应用重启后，把“账本上仍非终态、但 child 已无活动 turn”的任务修正为 interrupted。
   * 在 settleStaleRuntimeTurns 之后调用，此时 child 的 activeTurnId 已是终态真源。
   */
  async reconcileInterruptedTasks(): Promise<void> {
    const summaries = await this.options.threadStore.listThreads({ includeArchived: true, includeSide: true });
    for (const summary of summaries) {
      const thread = await this.options.threadStore.getThread(summary.id);
      const tasks = thread?.collaborationTasks ?? [];
      for (const task of tasks) {
        const tracked = this.rememberTrackedTask(thread!.id, task);
        if (TERMINAL_TASK_STATUSES.has(task.status)) continue;
        const child = await this.options.threadStore.getThread(task.childThreadId);
        const childActive = this.options.activeTask(task.childThreadId);
        if (child && (childActive || child.activeTurnId)) continue;
        await this.emitTaskStatus(
          tracked,
          'interrupted',
          { activeTurnId: task.activeTurnId },
        );
      }
    }
  }

  private async spawnAgent(
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const prompt = requiredString(input, ['prompt', 'task', 'input'], 'prompt');
    const parent = await this.options.threadStore.getThread(context.threadId);
    if (!parent) throw new Error(`Thread not found: ${context.threadId}`);
    assertSpawnCallerIsRootThread(parent, context.threadId);

    const existingTasks = parent.collaborationTasks ?? [];
    const activeChildCount = this.activeCollaborationChildCount(existingTasks);
    if (activeChildCount >= MAX_ACTIVE_COLLABORATION_CHILDREN) {
      throw new Error(
        `This thread already has ${activeChildCount} active collaboration children; the maximum is ${MAX_ACTIVE_COLLABORATION_CHILDREN}.`,
      );
    }

    const child = await this.options.threadStore.createThread({
      title: collaborationTitle(input, prompt),
      projectId: parent.projectId,
      parentThreadId: context.threadId,
      memoryMode: parent.memoryMode,
      modelBinding: parent.modelBinding ? { ...parent.modelBinding } : undefined,
    });
    const identity: RuntimeAgentIdentity = {
      displayName: collaborationDisplayName(input, existingTasks),
      avatarSeed: avatarSeedForThread(child.id),
    };
    const task: RuntimeCollaborationTask = {
      id: this.options.ids.id('task'),
      childThreadId: child.id,
      title: child.title,
      objective: prompt,
      identity,
      status: 'queued',
      createdAt: this.options.clock.now().toISOString(),
      updatedAt: this.options.clock.now().toISOString(),
    };
    // 先落盘账本（queued），再启动 child turn，保证父线程事件顺序：created 在 running 之前。
    await this.options.appendEvent(context.threadId, {
      id: this.options.ids.id('event'),
      threadId: context.threadId,
      type: 'collaboration.task_created',
      createdAt: task.createdAt,
      payload: { task },
    });

    const children = this.rememberPendingChild(context.threadId, child.id);
    const tracked: TrackedCollaborationTask = {
      childThreadId: child.id,
      lastStatus: 'queued',
      parentThreadId: context.threadId,
      taskId: task.id,
    };
    this.trackedTasksByChild.set(child.id, tracked);
    let started: { turnId: string };
    try {
      started = await this.options.startTurn(child.id, { name: identity.displayName, prompt, title: child.title });
    } catch (error) {
      children.delete(child.id);
      if (!children.size) this.childrenByParentThread.delete(context.threadId);
      this.trackedTasksByChild.delete(child.id);
      await this.emitTaskStatus(tracked, 'failed', { error: errorMessage(error) });
      throw error;
    }
    tracked.activeTurnId = started.turnId;
    tracked.lastStatus = 'running';
    // 显式落盘 running，避免 child 的 turn.started 观察事件与 spawn 返回之间出现空窗。
    await this.emitTaskStatus(tracked, 'running', { activeTurnId: started.turnId });
    const data = {
      tool: 'spawn_agent',
      senderThreadId: context.threadId,
      childThreadId: child.id,
      newThreadId: child.id,
      taskId: task.id,
      turnId: started.turnId,
      title: task.title,
      objective: prompt,
      identity,
      status: 'running',
    };
    return {
      collabToolCall: {
        tool: 'spawn_agent',
        senderThreadId: context.threadId,
        newThreadId: child.id,
        taskId: task.id,
        prompt,
        agentStatus: 'running',
      },
      content: JSON.stringify(data),
      data,
      preview: `Spawned child agent ${identity.displayName}.`,
    };
  }

  private async sendInput(
    name: 'send_input' | 'resume_agent',
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const receiverThreadId = requiredString(input, ['thread_id', 'threadId', 'receiver_thread_id', 'receiverThreadId'], 'thread_id');
    const content = requiredString(input, ['content', 'prompt', 'input'], 'content');
    await this.requireDirectChild(receiverThreadId, context);
    const resume = name === 'resume_agent';
    const parent = resume ? await this.options.threadStore.getThread(context.threadId) : null;
    if (resume && !parent) throw new Error(`Thread not found: ${context.threadId}`);
    const matchingTask = parent?.collaborationTasks?.find((task) => task.childThreadId === receiverThreadId);
    const tracked = matchingTask
      ? this.rememberTrackedTask(context.threadId, matchingTask)
      : this.trackedTasksByChild.get(receiverThreadId);
    const receiverActive = Boolean(this.options.activeTask(receiverThreadId));
    if (resume && parent && !receiverActive) {
      const currentActiveCount = this.activeCollaborationChildCount(parent.collaborationTasks ?? []);
      const targetAlreadyCounted = Boolean(
        matchingTask && !TERMINAL_TASK_STATUSES.has(matchingTask.status),
      );
      const resultingActiveCount = currentActiveCount + (targetAlreadyCounted ? 0 : 1);
      if (resultingActiveCount > MAX_ACTIVE_COLLABORATION_CHILDREN) {
        throw new Error(
          `Resuming this child would create ${resultingActiveCount} active collaboration children; the maximum is ${MAX_ACTIVE_COLLABORATION_CHILDREN}.`,
        );
      }
    }
    const delivered = await this.options.deliverMailbox(receiverThreadId, {
      content,
      deliveryMode: resume ? 'trigger_turn' : 'queue_only',
      fromAgentId: context.threadId,
      fromThreadId: context.threadId,
      toAgentId: receiverThreadId,
      triggerTurn: resume,
    });
    if (resume && delivered.turnId) {
      this.rememberPendingChild(context.threadId, receiverThreadId);
      const resumedTask = tracked ?? await this.trackedTaskForChild(receiverThreadId);
      if (resumedTask && resumedTask.activeTurnId !== delivered.turnId) {
        resumedTask.activeTurnId = delivered.turnId;
        await this.emitTaskStatus(resumedTask, 'running', { activeTurnId: delivered.turnId });
      }
    }
    const data = {
      tool: name,
      senderThreadId: context.threadId,
      receiverThreadId,
      turnId: delivered.turnId,
      queued: delivered.queued ?? false,
      status: delivered.turnId ? 'delivered' : 'queued',
    };
    return {
      collabToolCall: {
        tool: name,
        senderThreadId: context.threadId,
        receiverThreadId,
        prompt: content,
        agentStatus: delivered.turnId ? 'delivered' : 'queued',
      },
      content: JSON.stringify(data),
      data,
      preview: resume ? `Resumed agent ${receiverThreadId}.` : `Queued input for agent ${receiverThreadId}.`,
    };
  }

  private async waitForAgent(
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const receiverThreadId = requiredString(input, ['thread_id', 'threadId', 'receiver_thread_id', 'receiverThreadId'], 'thread_id');
    // 等待自己的当前 turn 用于自检，属于协作工具既有语义；其余目标必须是直属 child。
    if (receiverThreadId !== context.threadId) {
      await this.requireDirectChild(receiverThreadId, context);
    }
    const wait = await this.waitForThread(receiverThreadId, context, collaborationTimeoutMs(input));
    const thread = await this.options.threadStore.getThread(receiverThreadId);
    const activeTurnId = this.options.activeTask(receiverThreadId)?.turnId ?? null;
    const output = wait.status === 'running' ? '' : childAgentOutput(thread);
    if (receiverThreadId !== context.threadId && wait.status !== 'running') {
      // The terminal result is now present in this tool response, so forced convergence must not
      // append the same child output again after the parent has already produced its answer.
      this.removePendingChild(context.threadId, receiverThreadId);
    }
    const data = {
      tool: 'wait',
      senderThreadId: context.threadId,
      receiverThreadId,
      activeTurnId,
      status: wait.status,
      timedOut: wait.timedOut,
      lastMessagePreview: thread?.lastMessagePreview ?? '',
      ...(output ? { output } : {}),
    };
    return {
      collabToolCall: {
        tool: 'wait',
        senderThreadId: context.threadId,
        receiverThreadId,
        agentStatus: wait.status,
      },
      content: JSON.stringify(data),
      data,
      preview: wait.status === 'idle' ? `Agent ${receiverThreadId} is idle.` : `Agent ${receiverThreadId} is still running.`,
    };
  }

  private async closeAgent(
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const receiverThreadId = requiredString(input, ['thread_id', 'threadId', 'receiver_thread_id', 'receiverThreadId'], 'thread_id');
    const reason = optionalString(input, ['reason']);
    await this.requireDirectChild(receiverThreadId, context);
    const active = this.options.activeTask(receiverThreadId);
    const cancelled = active ? await this.options.cancelTurn(receiverThreadId, active.turnId) : false;
    this.removePendingChild(context.threadId, receiverThreadId);
    const data = {
      tool: 'close_agent',
      senderThreadId: context.threadId,
      receiverThreadId,
      cancelled,
      reason: reason || undefined,
      status: cancelled ? 'cancelled' : 'closed',
    };
    return {
      collabToolCall: {
        tool: 'close_agent',
        senderThreadId: context.threadId,
        receiverThreadId,
        agentStatus: cancelled ? 'cancelled' : 'closed',
      },
      content: JSON.stringify(data),
      data,
      preview: cancelled ? `Cancelled agent ${receiverThreadId}.` : `Closed agent ${receiverThreadId}.`,
    };
  }

  /** 校验协作工具目标确实是调用者的直属 child（kind 不参与判断，parentThreadId 即权威）。 */
  private async requireDirectChild(
    receiverThreadId: string,
    context: RuntimeToolExecutionContext,
  ): Promise<RuntimeThread> {
    const receiver = await this.options.threadStore.getThread(receiverThreadId);
    if (!receiver) throw new Error(`Thread not found: ${receiverThreadId}`);
    if (receiver.parentThreadId !== context.threadId) {
      throw new Error(`Thread ${receiverThreadId} is not a direct child of thread ${context.threadId}.`);
    }
    return receiver;
  }

  private activeCollaborationChildCount(tasks: RuntimeCollaborationTask[]): number {
    return tasks.filter((task) => (
      !TERMINAL_TASK_STATUSES.has(task.status)
      || Boolean(this.options.activeTask(task.childThreadId))
    )).length;
  }

  private rememberPendingChild(parentThreadId: string, childThreadId: string): Set<string> {
    let children = this.childrenByParentThread.get(parentThreadId);
    if (!children) {
      children = new Set<string>();
      this.childrenByParentThread.set(parentThreadId, children);
    }
    children.add(childThreadId);
    return children;
  }

  private removePendingChild(parentThreadId: string, childThreadId: string): void {
    const children = this.childrenByParentThread.get(parentThreadId);
    children?.delete(childThreadId);
    if (children && !children.size) this.childrenByParentThread.delete(parentThreadId);
  }

  private rememberTrackedTask(
    parentThreadId: string,
    task: RuntimeCollaborationTask,
  ): TrackedCollaborationTask {
    const existing = this.trackedTasksByChild.get(task.childThreadId);
    if (existing) return existing;
    const tracked: TrackedCollaborationTask = {
      activeTurnId: task.activeTurnId,
      childThreadId: task.childThreadId,
      lastStatus: task.status,
      parentThreadId,
      taskId: task.id,
    };
    this.trackedTasksByChild.set(task.childThreadId, tracked);
    return tracked;
  }

  /** 重启后首次收到 child 事件时，从父线程持久账本恢复内存跟踪。 */
  private async trackedTaskForChild(childThreadId: string): Promise<TrackedCollaborationTask | null> {
    const existing = this.trackedTasksByChild.get(childThreadId);
    if (existing) return existing;
    const child = await this.options.threadStore.getThread(childThreadId);
    if (!child?.parentThreadId || child.kind === 'side') return null;
    const parent = await this.options.threadStore.getThread(child.parentThreadId);
    const task = parent?.collaborationTasks?.find((candidate) => candidate.childThreadId === childThreadId);
    return task ? this.rememberTrackedTask(child.parentThreadId, task) : null;
  }

  private async emitTaskStatus(
    tracked: TrackedCollaborationTask,
    status: RuntimeCollaborationTaskStatus,
    patch: { activeTurnId?: string | undefined; error?: string; resultPreview?: string } = {},
  ): Promise<void> {
    if (TERMINAL_TASK_STATUSES.has(tracked.lastStatus) && TERMINAL_TASK_STATUSES.has(status)) return;
    tracked.lastStatus = status;
    const payload: RuntimeEvent['payload'] & { status: RuntimeCollaborationTaskStatus; taskId: string } = {
      taskId: tracked.taskId,
      status,
      ...(patch.activeTurnId ? { activeTurnId: patch.activeTurnId } : {}),
      ...(patch.resultPreview !== undefined ? { resultPreview: patch.resultPreview } : {}),
      ...(patch.error ? { error: patch.error } : {}),
    };
    await this.options.appendEvent(tracked.parentThreadId, {
      id: this.options.ids.id('event'),
      threadId: tracked.parentThreadId,
      type: 'collaboration.task_status_changed',
      createdAt: this.options.clock.now().toISOString(),
      payload,
    });
  }

  private async childResultPreview(childThreadId: string): Promise<string | undefined> {
    const child = await this.options.threadStore.getThread(childThreadId);
    const output = child ? childAgentOutput(child) : '';
    if (output) return clipPreview(output, 240);
    return child?.lastMessagePreview ? clipPreview(child.lastMessagePreview, 240) : undefined;
  }

  private async waitForThread(
    threadId: string,
    context: RuntimeToolExecutionContext,
    timeoutMs: number,
  ): Promise<{ status: 'idle' | 'running' | 'failed'; timedOut: boolean }> {
    const active = this.options.activeTask(threadId);
    if (!active) {
      if (!await this.options.threadStore.getThread(threadId)) throw new Error(`Thread not found: ${threadId}`);
      return { status: 'idle', timedOut: false };
    }
    if (active.threadId === context.threadId && active.turnId === context.turnId) {
      return { status: 'running', timedOut: false };
    }
    const wait = await waitForTask(active.done, context.signal, timeoutMs);
    if (wait === 'failed') return { status: 'failed', timedOut: false };
    if (wait === 'timeout') return { status: 'running', timedOut: true };
    return { status: this.options.activeTask(threadId) ? 'running' : 'idle', timedOut: false };
  }
}

function assertSpawnCallerIsRootThread(parent: RuntimeThread, threadId: string): void {
  // 第一版禁止 child 再 spawn child：只有根对话（非 side、无 parentThreadId）才能派生子代理。
  if (parent.parentThreadId) {
    throw new Error(`Thread ${threadId} is a collaboration child and cannot spawn its own agents.`);
  }
  if (parent.kind === 'side') {
    throw new Error(`Side conversations cannot spawn collaboration agents.`);
  }
}

function childAgentOutput(thread: RuntimeThread | null): string {
  if (!thread) return '';
  const latestTerminalTurn = [...(thread.turns ?? [])].reverse().find((turn) => turn.status && turn.status !== 'in_progress');
  const turnMessages = latestTerminalTurn
    ? thread.messages.filter((message) => message.turnId === latestTerminalTurn.id)
    : thread.messages;
  const assistantMessages = turnMessages
    .filter((message) => message.role === 'assistant' && message.visibility !== 'model');
  const assistantParts = assistantMessages
    .filter((message) => message.phase === 'final_answer')
    .map((message) => portableRuntimeAssistantMessageText(message).trim())
    .filter(Boolean);
  if (assistantParts.length) return assistantParts.join('\n\n');
  return '';
}

function childAgentTerminalOutcome(thread: RuntimeThread | null): string {
  if (!thread) return 'Child thread is unavailable.';
  const turn = [...(thread.turns ?? [])].reverse().find((candidate) => (
    candidate.status && candidate.status !== 'in_progress'
  ));
  if (turn?.status === 'failed') {
    return turn.error ? `Child turn failed: ${turn.error}` : 'Child turn failed.';
  }
  if (turn?.status === 'cancelled') {
    return turn.error ? `Child turn was cancelled: ${turn.error}` : 'Child turn was cancelled.';
  }
  return 'Child finished without a final answer.';
}

function requiredString(record: Record<string, unknown>, keys: string[], label: string): string {
  const value = optionalString(record, keys);
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function optionalString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function collaborationTitle(record: Record<string, unknown>, prompt: string): string {
  const title = optionalString(record, ['title', 'name']);
  if (title) return title;
  const compact = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  return compact ? `Subagent: ${compact}` : 'Subagent';
}

/** 短展示名：优先工具参数 name，其次按同父线程现有任务数生成 Agent N，并做去重。 */
function collaborationDisplayName(
  record: Record<string, unknown>,
  existingTasks: RuntimeCollaborationTask[],
): string {
  const requested = optionalString(record, ['name']).slice(0, 24);
  const existingNames = new Set(existingTasks.map((task) => task.identity.displayName));
  if (requested) {
    if (!existingNames.has(requested)) return requested;
    let suffix = 2;
    while (existingNames.has(`${requested} ${suffix}`)) suffix += 1;
    return `${requested} ${suffix}`;
  }
  const fallbackIndex = existingTasks.length + 1;
  return existingNames.has(`Agent ${fallbackIndex}`)
    ? `Agent ${fallbackIndex + 1}`
    : `Agent ${fallbackIndex}`;
}

function avatarSeedForThread(childThreadId: string): string {
  // 确定性哈希：同一 child 重启后头像稳定，且不依赖外部服务。
  let hash = 2166136261;
  for (let index = 0; index < childThreadId.length; index += 1) {
    hash ^= childThreadId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clipPreview(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join('')}…`;
}

function collaborationTimeoutMs(record: Record<string, unknown>): number {
  const value = record.timeout_ms ?? record.timeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  return Math.max(0, Math.min(30_000, Math.floor(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForTask(
  done: Promise<unknown> | undefined,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<'done' | 'failed' | 'timeout'> {
  if (!done) return 'done';
  if (signal.aborted) throw signal.reason ?? new Error('Turn cancelled.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      done.then(() => 'done' as const, () => 'failed' as const),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), timeoutMs);
        timeout.unref();
      }),
      new Promise<never>((_, reject) => {
        abortListener = () => reject(signal.reason ?? new Error('Turn cancelled.'));
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function waitForTaskCompletion(done: Promise<unknown> | undefined, signal: AbortSignal): Promise<void> {
  if (!done) return;
  if (signal.aborted) throw signal.reason ?? new Error('Turn cancelled.');
  let abortListener: (() => void) | undefined;
  try {
    await Promise.race([
      done.then(() => undefined, () => undefined),
      new Promise<never>((_, reject) => {
        abortListener = () => reject(signal.reason ?? new Error('Turn cancelled.'));
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}
