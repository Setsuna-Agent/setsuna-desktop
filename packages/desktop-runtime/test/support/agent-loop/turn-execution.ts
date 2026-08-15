import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { McpStore } from '../../../src/ports/mcp-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost, type ToolTurnCleanupOutcome } from '../../../src/ports/tool-host.js';

import {
  CapturingToolHost,
  testRuntimeEnvironment
} from './shared.js';

export class EmptyModelClient implements ModelClient {
  async *stream(): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class HiddenOnlyModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'reasoning_delta', text: 'I still need to finish the task.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ProviderMetadataToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const toolCall = { id: 'call_metadata_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' };
      yield {
        type: 'assistant_metadata',
        providerMetadata: {
          anthropic: {
            contentBlocks: [
              { type: 'thinking', thinking: 'Need the file.', signature: 'opaque-signature' },
              { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: { path: 'README.md' } },
            ],
          },
        },
      };
      yield {
        type: 'item_started',
        item: { id: toolCall.id, kind: 'tool_call', status: 'in_progress', toolCall },
      };
      yield {
        type: 'item_completed',
        item: { id: toolCall.id, kind: 'tool_call', status: 'completed', toolCall },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The metadata-backed tool continuation completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class StructuredToolContinuationModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'reasoning_delta', text: 'Need to inspect the file.' };
      yield { type: 'text_delta', text: 'Keep <think>literal text</think> visible.' };
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_structured_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Structured continuation completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

/** Simulates provider phase hints that runtime must ignore when it owns turn classification. */
export class ResponsesPhaseToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'item_started',
        item: { id: 'response_commentary', kind: 'agent_message', content: '', status: 'in_progress', phase: 'final_answer' },
      };
      yield { type: 'item_delta', itemId: 'response_commentary', delta: 'I will inspect the file.' };
      yield {
        type: 'item_completed',
        item: { id: 'response_commentary', kind: 'agent_message', content: 'I will inspect the file.', status: 'completed', phase: 'final_answer' },
      };
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_responses_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield {
      type: 'item_started',
      item: { id: 'response_final_1', kind: 'agent_message', content: '', status: 'in_progress', phase: 'final_answer' },
    };
    yield { type: 'item_delta', itemId: 'response_final_1', delta: 'The file ' };
    yield {
      type: 'item_completed',
      item: { id: 'response_final_1', kind: 'agent_message', content: 'The file ', status: 'completed', phase: 'final_answer' },
    };
    yield {
      type: 'item_started',
      item: { id: 'response_final_2', kind: 'agent_message', content: '', status: 'in_progress', phase: 'commentary' },
    };
    yield { type: 'item_delta', itemId: 'response_final_2', delta: 'is ready.' };
    yield {
      type: 'item_completed',
      item: { id: 'response_final_2', kind: 'agent_message', content: 'is ready.', status: 'completed', phase: 'commentary' },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class StepSnapshotModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_step_1', name: 'step_tool_1', arguments: '{}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Fresh step captured.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class FailingCleanupToolHost extends CapturingToolHost {
  override cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): void {
    super.cleanupTurn(context, outcome);
    throw new Error('cleanup failed after completion');
  }
}

export class RefreshingToolHost implements ToolHost {
  listCalls = 0;
  environmentCalls = 0;
  runContexts: ToolExecutionContext[] = [];

  environmentForToolContext(_context: ToolExecutionContext) {
    this.environmentCalls += 1;
    return testRuntimeEnvironment(`step_env_${this.environmentCalls}`, `/tmp/setsuna-step-${this.environmentCalls}`);
  }

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    this.listCalls += 1;
    if (!context.environment) throw new Error('Expected listTools to receive the step environment.');
    return [
      {
        name: `step_tool_${this.listCalls}`,
        description: 'Tool that changes between sampling steps',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ];
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    this.runContexts.push(context);
    return { content: `${name} result from current step` };
  }
}

export class StepSnapshotConfigStore implements ConfigStore {
  getConfigCalls = 0;

  async getConfig() {
    this.getConfigCalls += 1;
    const refreshed = this.getConfigCalls > 2;
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: refreshed ? 'test-updated' : 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: refreshed ? 'workspace-write' as const : 'read-only' as const,
      sandboxWorkspaceWrite: {
        writableRoots: [refreshed ? '/tmp/setsuna-step-writable-2' : '/tmp/setsuna-step-writable'],
        networkAccess: refreshed,
      },
      features: {
        request_permissions_tool: refreshed,
        step_snapshot: true,
        ...(refreshed ? { mid_turn_config_refresh: true } : {}),
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

export function stepSnapshotMcpStore(): Pick<McpStore, 'listServerInputs'> {
  return {
    listServerInputs: async () => [
      { key: 'zeta', transport: 'stdio', command: 'zeta-mcp', enabled: true },
      { key: 'disabled', transport: 'stdio', command: 'disabled-mcp', enabled: false },
      { key: 'alpha', transport: 'streamableHttp', url: 'https://mcp.example.test', enabled: true },
    ],
  };
}
