import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost, type ToolRuntimeProfile } from '../../../src/ports/tool-host.js';

import {
  PreviewingToolHost,
  StrictApprovalConfigStore,
  waitForTestState
} from './shared.js';

export class ShellOutputDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_shell', name: 'run_shell_command', arguments: '{"command":"echo streamed","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'saw output' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ParallelReadModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          { id: 'call_read', name: 'read_file', arguments: '{"file_path":"README.md"}' },
          { id: 'call_search', name: 'search_text', arguments: '{"query":"needle"}' },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'parallel results received' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ParallelSearchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          { id: 'call_search_first', name: 'search_text', arguments: '{"query":"first"}' },
          { id: 'call_search_second', name: 'search_text', arguments: '{"query":"second"}' },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'parallel search results received' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class DirectLookupToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_project_lookup', name: 'project_lookup', arguments: '{"id":"alpha"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'direct lookup complete' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ManyInspectionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: Array.from({ length: 10 }, (_, index) => ({
          id: `call_${index + 1}`,
          name: 'read_file',
          arguments: JSON.stringify({ file_path: `src/file-${index + 1}.ts` }),
        })),
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'inspection complete' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ForcedToolChoiceModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'forced choice observed' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class NoisyToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const content = Array.from({ length: 4_096 }, (_, index) => String(index % 10)).join('');
      yield {
        type: 'tool_call_delta',
        call: {
          id: 'call_noisy_delta',
          name: 'write_file',
          argumentsDelta: '{"file_path":"src/generated.txt","content":"',
        },
      };
      for (const character of content) {
        yield { type: 'tool_call_delta', call: { id: 'call_noisy_delta', name: 'write_file', argumentsDelta: character } };
      }
      yield { type: 'tool_call_delta', call: { id: 'call_noisy_delta', name: 'write_file', argumentsDelta: '"}' } };
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_noisy_delta',
          name: 'write_file',
          arguments: JSON.stringify({ file_path: 'src/generated.txt', content }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class LookupToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'tool_call_delta', call: { id: 'call_lookup_delta', name: 'project_lookup', argumentsDelta: '{"id":"alpha"}' } };
    yield { type: 'text_delta', text: 'handled direct lookup delta' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class OutputDeltaToolHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, risk_level: { type: 'string' } },
          required: ['command', 'risk_level'],
        },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    context.onToolOutputDelta?.({
      delta: 'streamed output\n',
      stream: 'stdout',
      processId: 'shell_test',
    });
    return {
      content: 'command completed',
      data: { process_id: 'shell_test', command: 'echo streamed', exit_code: 0 },
    };
  }
}

export class ParallelReadToolHost implements ToolHost {
  readonly started: string[] = [];
  readonly contexts: ToolExecutionContext[] = [];
  private readonly blocker: Promise<void>;
  private releaseBlocker: () => void = () => undefined;

  constructor() {
    this.blocker = new Promise<void>((resolve) => {
      this.releaseBlocker = resolve;
    });
  }

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      {
        name: 'search_text',
        description: 'Search text',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    this.started.push(name);
    this.contexts.push(context);
    await this.blocker;
    return { content: `${name} result` };
  }

  releaseAll(): void {
    this.releaseBlocker();
  }
}

export class SerialProfileReadToolHost extends ParallelReadToolHost {
  toolRuntimeProfile(_name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return { supportsParallel: false };
  }
}

export class LookupToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'direct_tool',
        description: 'A directly visible tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
      {
        name: 'project_lookup',
        description: 'Look up project facts',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    ];
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: `${name} result` };
  }
}

export class CountingReadToolHost implements ToolHost {
  readonly calls: Array<{ file_path?: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ];
  }

  async runTool(_name: string, input: unknown) {
    const parsed = input && typeof input === 'object' && !Array.isArray(input) ? input as { file_path?: unknown } : {};
    this.calls.push(parsed);
    return { content: `contents for ${String(parsed.file_path ?? 'unknown')}` };
  }
}

export class ForcedToolChoiceHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    ];
  }

  toolChoice() {
    return { type: 'tool' as const, name: 'write_file' };
  }

  async runTool() {
    return { content: 'unused' };
  }
}

export class LargePreviewingToolHost extends PreviewingToolHost {
  override async runTool() {
    this.calls += 1;
    return { content: 'wrote file', preview: largeFilePreview() };
  }
}

export class LookupPreviewingToolHost extends LookupToolHost {
  partialPreviewCalls: Array<{ name: string; rawArguments: string }> = [];

  async previewPartialToolCall(name: string, rawArguments: string) {
    this.partialPreviewCalls.push({ name, rawArguments });
    return {
      argumentsPreview: rawArguments,
      resultPreview: `preview for ${name}`,
    };
  }
}

export function largeFilePreview(): string {
  return JSON.stringify({
    diff: {
      path: 'src/generated.txt',
      action: 'Edited',
      additions: 1,
      deletions: 0,
      truncated: false,
      lines: [{ type: 'added', content: 'x'.repeat(61_000), newLine: 1 }],
    },
  });
}

export class SandboxWorkspaceWriteConfigStore extends StrictApprovalConfigStore {
  async getConfig() {
    return {
      ...(await super.getConfig()),
      sandboxWorkspaceWrite: {
        writableRoots: ['/tmp/setsuna-extra-writable'],
        networkAccess: false,
      },
    };
  }
}

export async function waitForToolStarts(toolHost: ParallelReadToolHost, count: number) {
  await waitForTestState(
    () => [...toolHost.started],
    (started) => started.length >= count,
    (started) => `Timed out waiting for ${count} parallel tool starts; saw ${started?.length ?? 0}; started=${JSON.stringify(started ?? [])}`,
  );
}