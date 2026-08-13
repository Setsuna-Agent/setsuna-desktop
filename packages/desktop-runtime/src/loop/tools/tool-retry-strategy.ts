import type {
  RuntimeConfigState,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import {
  ToolExecutionError,
  type RuntimeToolExecutionContext,
  type ToolExecutionEnvironment,
  type ToolExecutionResult,
  type ToolHost,
  type ToolOutputDelta,
  type ToolSandboxAttempt,
} from '../../ports/tool-host.js';
import { networkApprovalContextFromTool } from '../../security/network-approval-policy.js';
import { isAbortError, throwIfAborted } from '../core/runtime-turn-errors.js';
import type { ToolApprovalCoordinator } from './tool-approval-coordinator.js';
import {
  additionalSandboxPermissionsForTool,
  isShellCommandToolName,
  networkApprovalContextFromToolError,
  networkPolicyDeniedError,
  requestedSandboxBypass,
  suggestedSandboxReadableRoots,
  toolRunWithCancellationProfile,
} from './tool-orchestrator-policy.js';

export type ToolRetryStage =
  | 'network'
  | 'sandbox_readable_root'
  | 'sandbox_bypass';

export type ToolRetryOutcome =
  | {
      kind: 'success';
      result: ToolExecutionResult;
      stage: ToolRetryStage;
    }
  | {
      kind: 'terminal';
      content: string;
      processed: boolean;
      status: 'error' | 'rejected';
    };

export type ToolRetryInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: RuntimeToolExecutionContext;
  environment: ToolExecutionEnvironment;
  expectedPreviewIntegrityToken?: string;
  outputDeltaPublishes: Promise<void>[];
  parsedArguments: unknown;
  toolCall: RuntimeToolCall;
  toolError: ToolExecutionError;
  waitsForRuntimeCancellation: boolean;
};

type ToolRetryApprovalCoordinator = Pick<
  ToolApprovalCoordinator,
  | 'approveNetworkAccessRetry'
  | 'approveSandboxBypassRetry'
  | 'approveSandboxReadableRootsRetry'
>;

export type ToolRetryStrategyOptions = {
  approvals: ToolRetryApprovalCoordinator;
  toolHost: ToolHost;
  events: {
    publishToolOutputDelta(
      toolCall: RuntimeToolCall,
      delta: ToolOutputDelta,
    ): Promise<void>;
  };
  sandboxWorkspaceWriteForRun(
    context: RuntimeToolExecutionContext,
    extra: RuntimeSandboxWorkspaceWrite | undefined,
  ): RuntimeSandboxWorkspaceWrite;
};

/**
 * Decides and executes network/sandbox retries without publishing tool terminals.
 * The orchestrator remains the sole owner of delta flushing and completion events.
 */
export class ToolRetryStrategy {
  constructor(private readonly options: ToolRetryStrategyOptions) {}

  async retryAfterNetworkDenied(input: ToolRetryInput): Promise<ToolRetryOutcome> {
    const {
      approvalPolicy,
      context,
      environment,
      parsedArguments,
      toolCall,
      toolError,
    } = input;
    const networkApprovalContext = networkApprovalContextFromToolError(toolError)
      ?? networkApprovalContextFromTool(toolCall.name, parsedArguments);
    const commandWideNetworkApproval = isShellCommandToolName(toolCall.name);

    if (networkPolicyDeniedError(toolError)) {
      return {
        kind: 'terminal',
        content: `Tool ${toolCall.name} was blocked by persistent network policy: ${toolError.message}`,
        processed: true,
        status: 'error',
      };
    }

    const retryReason = commandWideNetworkApproval
      ? 'Network access applies to the entire command and grants process-wide capability. Review and approve this exact command before retrying.'
      : networkApprovalContext
        ? `Network access to "${networkApprovalContext.target}" is blocked by policy. Approve retry with network access.`
        : `Network access is blocked for ${toolCall.name}: ${toolError.message}. Approve retry with network access.`;
    const approvalAnswer = await this.options.approvals.approveNetworkAccessRetry(
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
      retryReason,
      environment,
      networkApprovalContext,
      commandWideNetworkApproval,
    );
    if (approvalAnswer.decision === 'reject') {
      return {
        kind: 'terminal',
        content: rejectionMessage(
          `Tool ${toolCall.name} network retry was rejected.`,
          approvalAnswer.message,
        ),
        processed: false,
        status: 'rejected',
      };
    }
    if (
      approvalAnswer.decision === 'approve_network_policy_amendment'
      && approvalAnswer.networkPolicyAmendment?.action === 'deny'
    ) {
      const target = approvalAnswer.networkPolicyAmendment.host
        || networkApprovalContext?.target
        || 'requested network target';
      return {
        kind: 'terminal',
        content: `Tool ${toolCall.name} network access was denied by persistent network policy for ${target}.`,
        processed: true,
        status: 'error',
      };
    }

    const retrySandbox: ToolSandboxAttempt = requestedSandboxBypass(
      toolCall.name,
      parsedArguments,
    )
      ? { mode: 'bypass', networkAccess: 'enabled', retryReason }
      : { mode: 'default', networkAccess: 'enabled', retryReason };
    try {
      const result = await this.runRetry(input, {
        sandbox: retrySandbox,
        sandboxWorkspaceWrite: additionalSandboxPermissionsForTool(
          toolCall,
          parsedArguments,
          context,
          environment,
        )?.sandboxWorkspaceWrite,
      });
      return { kind: 'success', result, stage: 'network' };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        kind: 'terminal',
        content: `Tool ${toolCall.name} failed after network retry: ${errorMessage(error)}`,
        processed: true,
        status: 'error',
      };
    }
  }

  async retryAfterSandboxDenied(input: ToolRetryInput): Promise<ToolRetryOutcome> {
    const {
      approvalPolicy,
      context,
      environment,
      parsedArguments,
      toolCall,
      toolError,
    } = input;
    const suggestedReadableRoots = suggestedSandboxReadableRoots(toolError, context);

    if (suggestedReadableRoots.length) {
      const narrowReason = `Sandbox could not read the resolved toolchain for ${toolCall.name}. Approve read-only access to: ${suggestedReadableRoots.join(', ')}.`;
      const narrowAnswer = await this.options.approvals.approveSandboxReadableRootsRetry(
        toolCall,
        parsedArguments,
        context,
        approvalPolicy,
        narrowReason,
        environment,
        suggestedReadableRoots,
      );
      if (narrowAnswer.decision === 'reject') {
        return {
          kind: 'terminal',
          content: rejectionMessage(
            `Tool ${toolCall.name} sandbox readable-root retry was rejected.`,
            narrowAnswer.message,
          ),
          processed: false,
          status: 'rejected',
        };
      }

      try {
        const result = await this.runRetry(input, {
          sandbox: { mode: 'default', retryReason: narrowReason },
          sandboxWorkspaceWrite: { readableRoots: suggestedReadableRoots },
        });
        return { kind: 'success', result, stage: 'sandbox_readable_root' };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (
          !(error instanceof ToolExecutionError)
          || error.failureKind !== 'sandbox_denied'
        ) {
          return {
            kind: 'terminal',
            content: `Tool ${toolCall.name} failed after sandbox readable-root retry: ${errorMessage(error)}`,
            processed: true,
            status: 'error',
          };
        }
      }
    }

    // “无需确认”只关闭审批交互，不得自动扩大为无沙箱执行。
    if (
      approvalPolicy === 'full'
      && context.permissionProfile !== 'danger-full-access'
    ) {
      return {
        kind: 'terminal',
        content: `Tool ${toolCall.name} was denied by the OS sandbox. No unsandboxed retry was attempted because the current mode disables prompts but keeps workspace sandboxing.`,
        processed: true,
        status: 'error',
      };
    }

    // The first-attempt output is already retained; approval text stays concise.
    const retryReason = `The OS sandbox blocked the first ${toolCall.name} attempt. Approve retry without the OS sandbox.`;
    const answer = await this.options.approvals.approveSandboxBypassRetry(
      toolCall,
      parsedArguments,
      context,
      retryReason,
      environment,
    );
    if (answer.decision === 'reject') {
      return {
        kind: 'terminal',
        content: rejectionMessage(
          `Tool ${toolCall.name} sandbox retry was rejected.`,
          answer.message,
        ),
        processed: false,
        status: 'rejected',
      };
    }

    try {
      const result = await this.runRetry(input, {
        sandbox: { mode: 'bypass', retryReason },
        sandboxWorkspaceWrite: additionalSandboxPermissionsForTool(
          toolCall,
          parsedArguments,
          context,
          environment,
        )?.sandboxWorkspaceWrite,
      });
      return { kind: 'success', result, stage: 'sandbox_bypass' };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        kind: 'terminal',
        content: `Tool ${toolCall.name} failed after sandbox retry: ${errorMessage(error)}`,
        processed: true,
        status: 'error',
      };
    }
  }

  private async runRetry(
    input: ToolRetryInput,
    attempt: {
      sandbox: ToolSandboxAttempt;
      sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
    },
  ): Promise<ToolExecutionResult> {
    const {
      context,
      expectedPreviewIntegrityToken,
      outputDeltaPublishes,
      parsedArguments,
      toolCall,
      waitsForRuntimeCancellation,
    } = input;
    let acceptingOutputDeltas = true;
    try {
      throwIfAborted(context.signal);
      const retryContext: RuntimeToolExecutionContext = {
        ...context,
        sandboxWorkspaceWrite: this.options.sandboxWorkspaceWriteForRun(
          context,
          attempt.sandboxWorkspaceWrite,
        ),
        sandbox: attempt.sandbox,
        toolCallId: toolCall.id,
        expectedPreviewIntegrityToken,
        onToolOutputDelta: (delta) => {
          if (!acceptingOutputDeltas) return;
          const publish = this.options.events
            .publishToolOutputDelta(toolCall, delta)
            .catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const toolRun = this.options.toolHost.runTool(
        toolCall.name,
        parsedArguments,
        retryContext,
      );
      return await toolRunWithCancellationProfile(
        toolRun,
        context.signal,
        waitsForRuntimeCancellation,
      );
    } finally {
      acceptingOutputDeltas = false;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rejectionMessage(fallback: string, rationale: string | undefined): string {
  return rationale ? `${fallback} ${rationale}` : fallback;
}
