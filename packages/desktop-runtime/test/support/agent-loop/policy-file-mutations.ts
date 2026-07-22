import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';


export class RepeatedFileWriteModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length <= 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_repeated_write_${this.requests.length}`, name: 'write_file', arguments: '{"file_path":"src/generated.txt","content":"generated\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ProtectedMetadataWriteModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_protected_write', name: 'write_file', arguments: '{"file_path":".git/config","content":"unsafe\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'blocked' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ShellApplyPatchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(
    private readonly filePath: string,
    private readonly commandPrefix = '',
    private readonly commandName = 'apply_patch',
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_patch',
          name: 'run_shell_command',
          arguments: JSON.stringify({
            command: shellApplyPatchCommand(this.filePath, this.commandPrefix, this.commandName),
            risk_level: 'low',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'shell patch handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ShellMentionApplyPatchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_search',
          name: 'run_shell_command',
          arguments: JSON.stringify({
            command: 'rg apply_patch',
            risk_level: 'low',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'search handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ShellApplyPatchInterceptHost implements ToolHost {
  calls: Array<{ name: string; input: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a shell command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, risk_level: { type: 'string' } },
          required: ['command', 'risk_level'],
        },
      },
      {
        name: 'apply_patch',
        description: 'Apply a patch',
        inputSchema: {
          type: 'object',
          properties: { patch: { type: 'string' } },
          required: ['patch'],
        },
      },
    ];
  }

  async previewToolCall(name: string, input: unknown) {
    if (name !== 'apply_patch') return null;
    return shellPatchPreview(input);
  }

  async runTool(name: string, input: unknown) {
    this.calls.push({ name, input });
    return { content: 'applied intercepted patch', preview: shellPatchPreview(input).resultPreview };
  }
}

export function shellPatchPreview(input: unknown) {
  const patch = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { patch?: unknown }).patch === 'string'
    ? (input as { patch: string }).patch
    : '';
  const filePath = /(?:\*\*\* Add File: |\*\*\* Update File: |\*\*\* Delete File: )(.+)/.exec(patch)?.[1]?.trim() || 'src/from-shell.txt';
  return {
    argumentsPreview: JSON.stringify({ patch }),
    resultPreview: JSON.stringify({
      diff: {
        path: filePath,
        action: 'Created',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', content: 'shell', newLine: 1 }],
      },
    }),
  };
}

export function shellApplyPatchCommand(filePath: string, prefix = '', commandName = 'apply_patch'): string {
  return [
    `${prefix}${commandName} <<'PATCH'`,
    '*** Begin Patch',
    `*** Add File: ${filePath}`,
    '+shell',
    '*** End Patch',
    'PATCH',
  ].join('\n');
}

export class EmptyAdditionalPermissionsExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_empty_additional',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'pwd',
            sandbox_permissions: 'with_additional_permissions',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The command ran with the default sandbox.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}