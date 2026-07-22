import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { PersistentToolApprovalStore } from '../../../src/ports/persistent-tool-approval-store.js';


export class RepeatedEscalatedPrefixExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_prefix_first',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status',
            sandbox_permissions: 'require_escalated',
            justification: 'needs unsandboxed git access',
            prefix_rule: ['git', 'status'],
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
          id: 'call_exec_prefix_second',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status --short',
            sandbox_permissions: 'require_escalated',
            justification: 'same approved prefix',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The prefix-approved commands ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class BroadEscalatedPrefixExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_broad_prefix_first',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status',
            sandbox_permissions: 'require_escalated',
            justification: 'needs broad git access',
            prefix_rule: ['git'],
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
          id: 'call_exec_broad_prefix_second',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git push',
            sandbox_permissions: 'require_escalated',
            justification: 'another broad git command',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The broad-prefix commands ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RepeatedAdditionalPermissionsExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly writableRoot: string) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_exec_additional_${this.requests.length}`,
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'curl https://api.example.com/a',
            sandbox_permissions: 'with_additional_permissions',
            additional_permissions: {
              network: { enabled: true },
              file_system: { write: [this.writableRoot] },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The additional-permissions command ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class InMemoryPersistentToolApprovalStore implements PersistentToolApprovalStore {
  private readonly approvalKeys = new Set<string>();

  async hasAll(keys: string[]): Promise<boolean> {
    return keys.length > 0 && keys.every((key) => this.approvalKeys.has(key));
  }

  async approve(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (key) this.approvalKeys.add(key);
    }
  }
}