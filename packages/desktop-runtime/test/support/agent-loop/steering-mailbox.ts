import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  ModelRequest,
  ModelStreamEvent,
  RuntimeEvent,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeToolDefinition,
  ThreadPatch,
  ThreadQuery
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { ThreadStore } from '../../../src/ports/thread-store.js';
import { type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';


export class MailboxAwareModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Mailbox handled.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class BlockingToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];
  private markStarted: () => void = () => undefined;
  private releaseTool: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.releaseTool = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    this.markStarted();
    await this.released;
    return { content: 'file contents from blocked tool' };
  }

  release(): void {
    this.releaseTool();
  }
}

export class BlockingUserShellHost implements ToolHost {
  calls: Array<{ command: string; projectId?: string; turnId?: string }> = [];
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a shell command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ];
  }

  async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { command?: unknown }).command === 'string'
      ? (input as { command: string }).command
      : '';
    this.calls.push({ command, projectId: context.projectId, turnId: context.turnId });
    this.markStarted();
    await new Promise<void>((resolve) => {
      if (!context.signal) {
        resolve();
        return;
      }
      if (context.signal.aborted) {
        resolve();
        return;
      }
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    context.signal?.throwIfAborted();
    return { content: 'user shell finished' };
  }
}

export class DelayedSteerAppendThreadStore implements ThreadStore {
  private markStarted: () => void = () => undefined;
  private releaseAppend: () => void = () => undefined;
  readonly steerAppendStarted = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly appendReleased = new Promise<void>((resolve) => {
    this.releaseAppend = resolve;
  });

  constructor(
    private readonly inner: ThreadStore,
    private readonly delayedClientId: string,
  ) {}

  listThreads(query?: ThreadQuery): Promise<RuntimeThreadSummary[]> {
    return this.inner.listThreads(query);
  }

  getThread(threadId: string): Promise<RuntimeThread | null> {
    return this.inner.getThread(threadId);
  }

  createThread(input?: CreateThreadInput): Promise<RuntimeThread> {
    return this.inner.createThread(input);
  }

  deleteThread(threadId: string): Promise<void> {
    return this.inner.deleteThread(threadId);
  }

  updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread> {
    return this.inner.updateThread(threadId, patch);
  }

  updateThreadMemoryMode(threadId: string, mode: NonNullable<RuntimeThread['memoryMode']>, reason?: string): Promise<RuntimeThread> {
    return this.inner.updateThreadMemoryMode(threadId, mode, reason);
  }

  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread> {
    return this.inner.updateMessage(threadId, messageId, patch);
  }

  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread> {
    return this.inner.deleteMessages(threadId, input);
  }

  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean): Promise<RuntimeThread> {
    return this.inner.truncateMessagesAfter(threadId, messageId, includeSelf);
  }

  clearThreadMessages(threadId: string): Promise<RuntimeThread> {
    return this.inner.clearThreadMessages(threadId);
  }

  async appendEvent(threadId: string, event: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    const payload = event.payload as { message?: { clientId?: string } };
    if (event.type === 'message.created' && payload.message?.clientId === this.delayedClientId) {
      this.markStarted();
      await this.appendReleased;
    }
    return this.inner.appendEvent(threadId, event);
  }

  listEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEvent[]> {
    return this.inner.listEvents(threadId, sinceSeq);
  }

  releaseSteerAppend(): void {
    this.releaseAppend();
  }
}

export class SteerableModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'text_delta', text: 'initial answer' };
      await this.firstResponseReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'guided answer' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstResponse(): void {
    this.releaseFirst();
  }
}

export class OversizedSteerCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Summarized oversized steer input.',
          important_constraints: ['Preserve the user steer intent.'],
          open_items: ['Continue after applying the steer.'],
          already_said: 'The active user steer was too large for the active context window.',
          tool_context: 'No tool output was involved.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    const localRequestCount = this.requests.filter((item) => item.model === 'local-runtime-smoke').length;
    if (localRequestCount === 1) {
      yield { type: 'text_delta', text: 'initial answer' };
      await this.firstResponseReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'guided answer after oversized steer summary' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstResponse(): void {
    this.releaseFirst();
  }
}