import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';

import {
  ReadOnlyConfigStore,
  testRuntimeEnvironment
} from './shared.js';

export class RequestPermissionsThenExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(
    private readonly grantedRoot: string,
    private readonly denyOptions?: { deniedRoot?: string; deniedSpecialRoot?: string; deniedGlobPattern?: string },
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_request_permissions_turn',
          name: 'request_permissions',
          arguments: JSON.stringify({
            reason: 'Allow reading and writing an external temp directory plus network access.',
            permissions: {
              network: { enabled: true },
              file_system: {
                read: [this.grantedRoot],
                write: [this.grantedRoot],
                entries: [
                  ...(this.denyOptions?.deniedRoot ? [{
                    path: { type: 'path', path: this.denyOptions.deniedRoot },
                    access: 'deny',
                  }] : []),
                  ...(this.denyOptions?.deniedSpecialRoot ? [{
                    path: { type: 'special', value: { kind: 'project_roots', subpath: this.denyOptions.deniedSpecialRoot } },
                    access: 'deny',
                  }] : []),
                  ...(this.denyOptions?.deniedGlobPattern ? [{
                    path: { type: 'glob_pattern', pattern: this.denyOptions.deniedGlobPattern },
                    access: 'deny',
                  }] : []),
                ],
              },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_after_request_permissions',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: `printf ok > ${this.grantedRoot}/allowed.txt`,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The request_permissions grant was used.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class SessionRequestPermissionsModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly grantedRoot: string) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_request_permissions_session',
          name: 'request_permissions',
          arguments: JSON.stringify({
            reason: 'Allow reusing an external temp directory across turns.',
            permissions: {
              file_system: {
                entries: [{
                  path: { type: 'path', path: this.grantedRoot },
                  access: 'write',
                }],
              },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: 'Session permission recorded.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_after_session_request_permissions',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: `printf ok > ${this.grantedRoot}/session.txt`,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The session grant was reused.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ProtectedAdditionalPermissionsExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_protected_additional',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'printf unsafe',
            sandbox_permissions: 'with_additional_permissions',
            additional_permissions: {
              file_system: { write: ['.git'] },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The unsafe command was rejected.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RequestPermissionsExecToolHost implements ToolHost {
  contexts: ToolExecutionContext[] = [];

  constructor(
    private readonly cwd = process.cwd(),
    private readonly environmentId?: string,
  ) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'request_permissions',
        description: 'A Codex-compatible permission request tool',
        inputSchema: { type: 'object', properties: { permissions: { type: 'object' } } },
      },
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  environmentForToolContext(context: ToolExecutionContext) {
    return testRuntimeEnvironment(this.environmentId ?? context.projectId ?? context.threadId, this.cwd);
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    if (name === 'request_permissions') throw new Error('request_permissions should be handled by the orchestrator');
    this.contexts.push(context);
    return { content: 'ran after request_permissions' };
  }
}

export function contentIncludesPath(content: string, filePath: string): boolean {
  return content.includes(filePath) || content.includes(JSON.stringify(filePath).slice(1, -1));
}

export class RequestPermissionsDisabledConfigStore extends ReadOnlyConfigStore {
  async getConfig() {
    return {
      ...(await super.getConfig()),
      features: { request_permissions_tool: false },
    };
  }
}