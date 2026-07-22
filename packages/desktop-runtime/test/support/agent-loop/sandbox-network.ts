import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { PolicyAmendmentStore } from '../../../src/ports/policy-amendment-store.js';
import { ToolExecutionError, type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';


export class SandboxDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_sandboxed', name: 'sandboxed_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The sandboxed tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RepeatedSandboxDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_sandboxed_${this.requests.length}`, name: 'sandboxed_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated sandboxed tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class NetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network', name: 'network_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The network tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RepeatedNetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_network_${this.requests.length}`, name: 'network_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated network tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class EscalatedNetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_escalated_network',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'curl https://api.example.com/a',
            sandbox_permissions: 'require_escalated',
            justification: 'needs unsandboxed network access',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The escalated network command recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RepeatedHostNetworkShellModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network_a', name: 'run_shell_command', arguments: '{"command":"curl https://api.example.com/a","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network_b', name: 'run_shell_command', arguments: '{"command":"curl https://api.example.com/b","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated host network commands recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class SandboxRetryToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'sandboxed_tool',
        description: 'A tool that needs sandbox retry',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.mode ?? 'missing');
    if (context.sandbox?.mode !== 'bypass') {
      throw new ToolExecutionError('seatbelt denied file write', {
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
    }
    return { content: 'retried without sandbox' };
  }
}

export class NetworkRetryToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'network_tool',
        description: 'A tool that needs network retry',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.networkAccess ?? 'default');
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: 'retried with network' };
  }
}

export class EscalatedNetworkRetryToolHost implements ToolHost {
  attempts: Array<{ mode: string; networkAccess: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool that needs network retry',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    const args = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    return name === 'exec_command' && args.sandbox_permissions === 'require_escalated'
      ? {
          reason: String(args.justification || 'requires escalated sandbox permissions'),
          argumentsPreview: JSON.stringify(input),
        }
      : null;
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push({
      mode: context.sandbox?.mode ?? 'missing',
      networkAccess: context.sandbox?.networkAccess ?? 'default',
    });
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: 'retried escalated command with network' };
  }
}

export class ShellNetworkRetryToolHost implements ToolHost {
  attempts: Array<{ command: string; networkAccess: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'A shell tool that needs network retry',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      },
    ];
  }

  async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input)
      ? String((input as Record<string, unknown>).command || '')
      : '';
    this.attempts.push({ command, networkAccess: context.sandbox?.networkAccess ?? 'default' });
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: `retried with network: ${command}` };
  }
}

export class PolicyAwareShellNetworkRetryToolHost extends ShellNetworkRetryToolHost {
  constructor(private readonly policyAmendmentStore: PolicyAmendmentStore) {
    super();
  }

  override async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input)
      ? String((input as Record<string, unknown>).command || '')
      : '';
    this.attempts.push({ command, networkAccess: context.sandbox?.networkAccess ?? 'default' });
    if (context.sandbox?.networkAccess === 'enabled') return { content: `retried with network: ${command}` };
    const networkContext = {
      host: 'api.example.com',
      protocol: 'https',
      port: 443,
      target: 'https://api.example.com:443',
    };
    const amendments = await this.policyAmendmentStore.listPolicyAmendments();
    if (amendments.networkPolicyAmendments.some((item) => item.host === networkContext.host && item.action === 'deny')) {
      throw new ToolExecutionError('blocked by persistent network policy', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
        data: {
          network_policy_decision: 'deny',
          network_approval_context: networkContext,
        },
      });
    }
    throw new ToolExecutionError('network access disabled', {
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: networkContext,
      },
    });
  }
}