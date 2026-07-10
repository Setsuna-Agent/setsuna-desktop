import type { RuntimeCollabToolCall, RuntimeConfigState, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../ports/tool-host.js';

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

export type RuntimeCollaborationCoordinatorOptions = {
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
  startTurn(threadId: string, input: string): Promise<{ turnId: string }>;
};

const COLLABORATION_TOOL_NAMES = new Set(['spawn_agent', 'send_input', 'resume_agent', 'wait', 'close_agent']);

export const COLLABORATION_TOOL_DEFINITIONS: RuntimeToolDefinition[] = [
  {
    name: 'spawn_agent',
    description: 'Start a child agent thread for a focused subtask and return its thread and turn identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task prompt for the child agent.' },
        title: { type: 'string', description: 'Optional child thread title.' },
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
    description: 'Wait briefly for another agent thread to finish its current turn and return its status.',
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

/** Owns collaboration tool semantics while AgentLoop retains event rendering. */
export class RuntimeCollaborationCoordinator {
  constructor(private readonly options: RuntimeCollaborationCoordinatorOptions) {}

  async execute(name: string, parsedArguments: unknown, context: RuntimeToolExecutionContext): Promise<CollaborationExecutionResult> {
    const input = recordInput(parsedArguments);
    if (name === 'spawn_agent') return this.spawnAgent(input, context);
    if (name === 'send_input' || name === 'resume_agent') return this.sendInput(name, input, context);
    if (name === 'wait') return this.waitForAgent(input, context);
    if (name === 'close_agent') return this.closeAgent(input, context);
    throw new Error(`Unknown collaboration tool: ${name}`);
  }

  private async spawnAgent(
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const prompt = requiredString(input, ['prompt', 'task', 'input'], 'prompt');
    const parent = await this.options.threadStore.getThread(context.threadId);
    if (!parent) throw new Error(`Thread not found: ${context.threadId}`);
    const child = await this.options.threadStore.createThread({
      title: collaborationTitle(input, prompt),
      projectId: parent.projectId,
      parentThreadId: context.threadId,
      memoryMode: parent.memoryMode,
    });
    const started = await this.options.startTurn(child.id, prompt);
    const data = {
      tool: 'spawn_agent',
      senderThreadId: context.threadId,
      newThreadId: child.id,
      turnId: started.turnId,
      prompt,
      status: 'running',
    };
    return {
      collabToolCall: {
        tool: 'spawn_agent',
        senderThreadId: context.threadId,
        newThreadId: child.id,
        prompt,
        agentStatus: 'running',
      },
      content: JSON.stringify(data),
      data,
      preview: `Spawned child agent ${child.id}.`,
    };
  }

  private async sendInput(
    name: 'send_input' | 'resume_agent',
    input: Record<string, unknown>,
    context: RuntimeToolExecutionContext,
  ): Promise<CollaborationExecutionResult> {
    const receiverThreadId = requiredString(input, ['thread_id', 'threadId', 'receiver_thread_id', 'receiverThreadId'], 'thread_id');
    const content = requiredString(input, ['content', 'prompt', 'input'], 'content');
    const resume = name === 'resume_agent';
    const delivered = await this.options.deliverMailbox(receiverThreadId, {
      content,
      deliveryMode: resume ? 'trigger_turn' : 'queue_only',
      fromAgentId: context.threadId,
      fromThreadId: context.threadId,
      toAgentId: receiverThreadId,
      triggerTurn: resume,
    });
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
    const wait = await this.waitForThread(receiverThreadId, context, collaborationTimeoutMs(input));
    const thread = await this.options.threadStore.getThread(receiverThreadId);
    const activeTurnId = this.options.activeTask(receiverThreadId)?.turnId ?? null;
    const data = {
      tool: 'wait',
      senderThreadId: context.threadId,
      receiverThreadId,
      activeTurnId,
      status: wait.status,
      timedOut: wait.timedOut,
      lastMessagePreview: thread?.lastMessagePreview ?? '',
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
    const active = this.options.activeTask(receiverThreadId);
    const cancelled = active ? await this.options.cancelTurn(receiverThreadId, active.turnId) : false;
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

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function collaborationTimeoutMs(record: Record<string, unknown>): number {
  const value = record.timeout_ms ?? record.timeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  return Math.max(0, Math.min(30_000, Math.floor(value)));
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
