import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeMessage
} from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';


export class CollaborationToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.messages.some((message) => message.content.includes('<mailbox_message'))) {
      yield { type: 'text_delta', text: 'Child resumed with mailbox.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (request.messages.some((message) => message.role === 'user' && message.content === 'Inspect auth as child')) {
      yield { type: 'text_delta', text: 'Child initial result.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    const childThreadId = childThreadIdFromCollaborationToolMessages(request.messages);
    if (!childThreadId) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_spawn_agent', name: 'spawn_agent', arguments: '{"prompt":"Inspect auth as child","title":"Auth child"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'send_input')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_send_input', name: 'send_input', arguments: JSON.stringify({ thread_id: childThreadId, content: 'queued clue' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'resume_agent')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_resume_agent', name: 'resume_agent', arguments: JSON.stringify({ thread_id: childThreadId, content: 'resume with queued clue' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'wait')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_wait', name: 'wait', arguments: JSON.stringify({ thread_id: childThreadId }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'close_agent')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_close_agent', name: 'close_agent', arguments: JSON.stringify({ thread_id: childThreadId, reason: 'done' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Parent completed collaboration.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class CollaborationJoinModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  parentRequests: ModelRequest[] = [];
  private markChildStarted: () => void = () => undefined;
  private releaseChild: () => void = () => undefined;
  readonly childStarted = new Promise<void>((resolve) => {
    this.markChildStarted = resolve;
  });
  private readonly childReleased = new Promise<void>((resolve) => {
    this.releaseChild = resolve;
  });

  finishChild(): void {
    this.releaseChild();
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.messages.some((message) => message.role === 'user' && message.content === 'perform slow child research')) {
      this.markChildStarted();
      await this.childReleased;
      yield { type: 'text_delta', text: 'Detailed child research.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    this.parentRequests.push(request);
    if (this.parentRequests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_spawn_slow_child', name: 'spawn_agent', arguments: '{"prompt":"perform slow child research","title":"Slow research"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.parentRequests.length === 2) {
      yield { type: 'text_delta', text: 'The child is still researching, so I will not wait.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Parent incorporated the child research.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export function hasToolMessage(messages: RuntimeMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === 'tool' && message.toolName === toolName);
}

export function childThreadIdFromCollaborationToolMessages(messages: RuntimeMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const parsed = parseToolMessageJson(message.content);
    if (typeof parsed?.newThreadId === 'string') return parsed.newThreadId;
  }
  return '';
}

export function parseToolMessageJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class MultiAgentConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: {},
      features: {
        multi_agent: true,
      },
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}