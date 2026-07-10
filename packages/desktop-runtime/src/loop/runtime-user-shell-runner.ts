import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { ToolExecutionContext, ToolHost, ToolTurnCleanupOutcome } from '../ports/tool-host.js';

type RuntimeUserShellRunnerOptions = {
  clock: Clock;
  ids: IdGenerator;
  toolHost?: ToolHost;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void>;
  completeMessage(threadId: string, turnId: string, messageId: string): Promise<void>;
  publishTurnCancelledOnce(
    threadId: string,
    turnId: string,
    taskKind: 'user_shell',
    reason: string,
    options: { marker?: boolean },
  ): Promise<boolean>;
};

/** Executes user-originated shell commands while projecting the standard tool lifecycle. */
export class RuntimeUserShellRunner {
  constructor(private readonly options: RuntimeUserShellRunnerOptions) {}

  async execute({
    activeTurnId,
    command,
    signal,
    standaloneTurn,
    thread,
    threadId,
    turnId,
  }: {
    activeTurnId?: string | null;
    command: string;
    signal?: AbortSignal;
    standaloneTurn: boolean;
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<void> {
    const toolHost = this.options.toolHost;
    if (!toolHost) throw new Error('Tool host is not configured.');
    const toolCallId = this.options.ids.id('call_shell');
    const startedAtDate = this.options.clock.now();
    const startedAtMs = startedAtDate.getTime();
    const startedAt = startedAtDate.toISOString();
    const argumentsPreview = JSON.stringify({ command, risk_level: 'low', yield_time_ms: 0 });
    const deltaPublishes: Promise<void>[] = [];
    const holderMessageId = threadHasAssistantForTurn(thread, turnId) ? null : this.options.ids.id('msg_shell');

    if (standaloneTurn) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.started',
        createdAt: startedAt,
        payload: { input: command, taskKind: 'user_shell' },
      });
    }
    if (holderMessageId) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'message.created',
        createdAt: startedAt,
        payload: {
          message: {
            id: holderMessageId,
            turnId,
            role: 'assistant',
            content: '',
            createdAt: startedAt,
            status: 'streaming',
          },
        },
      });
    }
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.started',
      createdAt: startedAt,
      payload: {
        toolCallId,
        toolName: 'run_shell_command',
        source: 'userShell',
        argumentsPreview,
      },
    });

    let status: 'success' | 'error' = 'success';
    let cleanupStatus: ToolTurnCleanupOutcome['status'] = 'completed';
    let content = '';
    let data: unknown;
    try {
      throwIfAborted(signal);
      const result = await toolHost.runTool('run_shell_command', {
        command,
        risk_level: 'low',
        yield_time_ms: 0,
      }, {
        threadId,
        projectId: thread.projectId,
        turnId,
        toolCallId,
        permissionProfile: 'danger-full-access',
        signal,
        onToolOutputDelta: (delta) => {
          const publish = this.options.appendEvent(threadId, {
            id: this.options.ids.id('event'),
            threadId,
            turnId,
            type: 'tool.output_delta',
            createdAt: this.options.clock.now().toISOString(),
            payload: {
              toolCallId,
              toolName: 'run_shell_command',
              source: 'userShell',
              delta: delta.delta,
              stream: delta.stream,
              processId: delta.processId,
            },
          }).then(() => undefined, () => undefined);
          deltaPublishes.push(publish);
        },
      });
      throwIfAborted(signal);
      content = result.content;
      data = result.data;
    } catch (error) {
      await Promise.all(deltaPublishes);
      if (isAbortError(error)) {
        cleanupStatus = 'cancelled';
        if (holderMessageId) await this.options.completeMessage(threadId, turnId, holderMessageId);
        if (standaloneTurn) {
          await this.options.publishTurnCancelledOnce(
            threadId,
            turnId,
            'user_shell',
            error instanceof Error ? error.message : 'Turn cancelled.',
            { marker: true },
          );
        }
        await this.options.cleanupTurn({ threadId, projectId: thread.projectId, turnId, toolCallId }, { status: cleanupStatus });
        return;
      }
      status = 'error';
      cleanupStatus = 'failed';
      content = error instanceof Error ? error.message : String(error);
    }

    await Promise.all(deltaPublishes);
    const completedAt = this.options.clock.now();
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.completed',
      createdAt: completedAt.toISOString(),
      payload: {
        toolCallId,
        toolName: 'run_shell_command',
        source: 'userShell',
        status,
        content,
        argumentsPreview,
        data,
        durationMs: Math.max(0, completedAt.getTime() - startedAtMs),
      },
    });
    if (holderMessageId) await this.options.completeMessage(threadId, turnId, holderMessageId);
    if (activeTurnId) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'message.created',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: {
            id: this.options.ids.id('msg_shell'),
            turnId,
            role: 'tool',
            toolCallId,
            toolName: 'run_shell_command',
            content,
            createdAt: this.options.clock.now().toISOString(),
            status: 'complete',
          },
        },
      });
    }
    if (standaloneTurn) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { taskKind: 'user_shell' },
      });
    }
    await this.options.cleanupTurn({ threadId, projectId: thread.projectId, turnId, toolCallId }, { status: cleanupStatus });
  }
}

function threadHasAssistantForTurn(thread: RuntimeThread, turnId: string): boolean {
  return thread.messages.some((message) => message.turnId === turnId && message.role === 'assistant');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.');
  error.name = 'AbortError';
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
}
