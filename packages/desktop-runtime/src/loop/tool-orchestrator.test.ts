import { describe, expect, it, vi } from 'vitest';
import type { RuntimeToolHookRunner } from '../hooks/runtime-hooks.js';
import type { ApprovalGate, CreateApprovalInput } from '../ports/approval-gate.js';
import { systemClock } from '../ports/clock.js';
import { ToolExecutionError, type RuntimeToolExecutionContext, type ToolHost } from '../ports/tool-host.js';
import { ToolApprovalStore, ToolOrchestrator } from './tool-orchestrator.js';

describe('ToolApprovalStore', () => {
  it('releases every turn-scoped grant when a turn finishes', () => {
    const store = new ToolApprovalStore();
    store.approveForTurn('turn_1', ['exec:git-status']);
    store.enableStrictAutoReviewForTurn('turn_1');
    store.grantSandboxPermissions('turn', 'turn_1', 'environment_1', { writableRoots: ['/workspace'] });

    store.clearTurn('turn_1');

    expect(store.hasAll(['exec:git-status'], 'turn_1')).toBe(false);
    expect(store.strictAutoReviewEnabled('turn_1')).toBe(false);
    expect(store.sandboxWorkspaceWriteFor('turn_1', 'environment_1')).toEqual({});
  });
});

describe('ToolOrchestrator terminal and retry handling', () => {
  it.each(['network_denied', 'sandbox_denied'] as const)('runs post-processing and PostToolUse after a %s retry', async (failureKind) => {
    let attempts = 0;
    const toolHost = stubToolHost(async () => {
      attempts += 1;
      if (attempts === 1) throw new ToolExecutionError('retry required', { failureKind });
      return { content: 'retried result', data: { attempt: attempts } };
    });
    const postHook = vi.fn(async () => ({
      additionalContexts: ['retry audited'],
      shouldBlock: false,
    }));
    const postProcessResult = vi.fn(async (result) => ({ ...result, content: `${result.content} processed` }));
    const fixture = createOrchestratorFixture(toolHost, postHook);

    const execution = await fixture.orchestrator.runToolCall(
      { id: 'call_retry', name: 'network_tool', arguments: '{}' },
      {},
      executionContext(),
      'full',
      { postProcessResult },
    );

    expect(attempts).toBe(2);
    expect(postProcessResult).toHaveBeenCalledTimes(1);
    expect(postHook).toHaveBeenCalledTimes(1);
    expect(execution).toMatchObject({ status: 'success', content: expect.stringContaining('retry audited') });
    expect(fixture.completions).toEqual([
      expect.objectContaining({ status: 'success', content: expect.stringContaining('retried result processed') }),
    ]);
  });

  it('uses the cancellation profile while waiting for a retry runtime', async () => {
    let attempts = 0;
    let signalRetryStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => { signalRetryStarted = resolve; });
    const toolHost = stubToolHost(async () => {
      attempts += 1;
      if (attempts === 1) throw new ToolExecutionError('network denied', { failureKind: 'network_denied' });
      signalRetryStarted();
      return new Promise(() => undefined);
    });
    const fixture = createOrchestratorFixture(toolHost);
    const controller = new AbortController();
    const context = executionContext(controller.signal);

    const running = fixture.orchestrator.runToolCall(
      { id: 'call_cancel_retry', name: 'network_tool', arguments: '{}' },
      {},
      context,
      'full',
      { waitsForRuntimeCancellation: false },
    );
    await retryStarted;
    controller.abort('cancel retry');

    await expect(running).rejects.toMatchObject({ name: 'AbortError', message: 'cancel retry' });
    expect(fixture.completions).toEqual([]);
  });

  it('publishes one error terminal when result post-processing fails', async () => {
    const toolHost = stubToolHost(async () => ({ content: 'side effect completed' }));
    const fixture = createOrchestratorFixture(toolHost);

    const execution = await fixture.orchestrator.runToolCall(
      { id: 'call_postprocess_error', name: 'local_tool', arguments: '{}' },
      {},
      executionContext(),
      'full',
      {
        postProcessResult: async () => {
          throw new Error('attachment storage failed');
        },
      },
    );

    expect(execution).toMatchObject({ status: 'error', content: expect.stringContaining('attachment storage failed') });
    expect(fixture.completions).toEqual([
      expect.objectContaining({ status: 'error', content: expect.stringContaining('attachment storage failed') }),
    ]);
  });

  it('shows the full compound command instead of a misleading single-host network approval', async () => {
    const command = 'curl https://allowed.example/a; curl https://evil.example/b';
    let approvalInput: CreateApprovalInput | undefined;
    const approvalGate = {
      createApproval: async (input: CreateApprovalInput) => {
        approvalInput = input;
        return {
          ...input,
          id: 'approval_network',
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
      },
      waitForDecision: async () => ({ decision: 'reject' as const }),
      answerApproval: async () => { throw new Error('not expected'); },
      listApprovals: async () => ({ approvals: [] }),
      forgetApproval: () => undefined,
    } as ApprovalGate;
    const toolHost: ToolHost = {
      listTools: async () => [],
      toolRuntimeProfile: async () => ({ approvalMode: 'selfManaged' }),
      runTool: async () => {
        throw new ToolExecutionError('network denied', {
          failureKind: 'network_denied',
          data: {
            network_approval_contexts: [
              { host: 'allowed.example', protocol: 'https', port: 443, target: 'https://allowed.example:443' },
              { host: 'evil.example', protocol: 'https', port: 443, target: 'https://evil.example:443' },
            ],
          },
        });
      },
    };
    const fixture = createOrchestratorFixture(toolHost, undefined, approvalGate);

    const execution = await fixture.orchestrator.runToolCall(
      { id: 'call_compound_network', name: 'run_shell_command', arguments: JSON.stringify({ command }) },
      { command },
      executionContext(),
      'strict',
    );

    expect(execution.status).toBe('rejected');
    expect(approvalInput?.argumentsPreview).toContain('allowed.example');
    expect(approvalInput?.argumentsPreview).toContain('evil.example');
    expect(approvalInput?.networkApprovalContext).toBeUndefined();
    expect(approvalInput?.proposedNetworkPolicyAmendments).toBeUndefined();
  });

  it('does not reuse a truncated command-wide network approval for a different long command', async () => {
    const approvalStore = new ToolApprovalStore();
    const createApproval = vi.fn(async (input: CreateApprovalInput) => ({
      ...input,
      id: `approval_${createApproval.mock.calls.length}`,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }));
    const approvalGate = {
      createApproval,
      waitForDecision: async () => ({ decision: 'approve_for_session' as const }),
      answerApproval: async () => { throw new Error('not expected'); },
      listApprovals: async () => ({ approvals: [] }),
      forgetApproval: () => undefined,
    } as ApprovalGate;
    const toolHost = stubToolHost(async (_name, _input, context) => {
      if (context.sandbox?.networkAccess === 'enabled') return { content: 'network allowed' };
      throw new ToolExecutionError('network denied', { failureKind: 'network_denied' });
    });
    const fixture = createOrchestratorFixture(toolHost, undefined, approvalGate, approvalStore);
    const padding = `printf ${'x'.repeat(1_500)}`;
    const commands = [
      `${padding}; curl https://first.example/data`,
      `${padding}; curl https://second.example/data`,
    ];

    for (const [index, command] of commands.entries()) {
      const execution = await fixture.orchestrator.runToolCall(
        { id: `call_long_network_${index}`, name: 'run_shell_command', arguments: JSON.stringify({ command }) },
        { command },
        executionContext(),
        'strict',
      );
      expect(execution.status, execution.content).toBe('success');
    }

    const networkApprovals = createApproval.mock.calls
      .map(([input]) => input)
      .filter((input) => input.reason.toLowerCase().includes('network access'));
    expect(networkApprovals).toHaveLength(2);
  });
});

function stubToolHost(runTool: ToolHost['runTool']): ToolHost {
  return {
    listTools: async () => [],
    runTool,
  };
}

function createOrchestratorFixture(
  toolHost: ToolHost,
  postHook: RuntimeToolHookRunner['runPostToolUse'] | undefined = async () => ({ additionalContexts: [], shouldBlock: false }),
  approvalGate?: ApprovalGate,
  approvalStore?: ToolApprovalStore,
) {
  const completions: Array<{ status: 'success' | 'error' | 'rejected'; content: string }> = [];
  const hookRunner = {
    runPreToolUse: async () => ({ action: 'continue', additionalContexts: [] }),
    runPermissionRequest: async () => ({ decision: 'none' }),
    runPostToolUse: postHook ?? (async () => ({ additionalContexts: [], shouldBlock: false })),
  } as unknown as RuntimeToolHookRunner;
  const orchestrator = new ToolOrchestrator({
    toolHost,
    approvalGate,
    approvalStore,
    hookRunner,
    clock: systemClock,
    events: {
      publishToolStarted: async () => undefined,
      publishToolCompleted: async (_toolCall, _parsedArguments, status, content) => {
        completions.push({ status, content });
      },
      publishToolOutputDelta: async () => undefined,
      publishHookStarted: async () => undefined,
      publishHookCompleted: async () => undefined,
      publishApprovalRequested: async () => undefined,
      publishApprovalResolved: async () => undefined,
    },
  });
  return { completions, orchestrator };
}

function executionContext(signal = new AbortController().signal): RuntimeToolExecutionContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    environment: { id: 'local', cwd: '/workspace', workspaceRoot: '/workspace', workspaceRoots: ['/workspace'] },
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    signal,
  };
}
