import type {
  RuntimeApprovalDecision,
  RuntimeApprovalReviewer,
  RuntimeConfigState,
  RuntimeExecPolicyAmendment,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeToolHookEvents,
  RuntimeToolHookRunner,
} from '../../hooks/runtime-hooks.js';
import type { ApprovalGate, CreateApprovalInput } from '../../ports/approval-gate.js';
import type { ApprovalReviewer } from '../../ports/approval-reviewer.js';
import type { PersistentToolApprovalStore } from '../../ports/persistent-tool-approval-store.js';
import type { PolicyAmendmentStore } from '../../ports/policy-amendment-store.js';
import type {
  RuntimeToolExecutionContext,
  ToolExecutionEnvironment,
  ToolHost,
  ToolRuntimeProfile,
} from '../../ports/tool-host.js';
import type { RuntimeNetworkApprovalContext } from '../../security/network-approval-policy.js';
import {
  requestToolApproval,
  type ResolvedToolApprovalAnswer,
  type ToolApprovalLifecycleEvents,
} from './tool-approval-lifecycle.js';
import { ToolApprovalStore } from './tool-approval-store.js';
import {
  assessAdditionalSandboxPermissionsApproval,
  assessFileMutationApproval,
  decisionGrantsSessionReuse,
  effectiveToolCallFor,
  execApprovalApprovalKeys,
  execApprovalSessionLookupKeys,
  networkApprovalAvailableDecisions,
  networkRetryApprovalKeys,
  previewArguments,
  proposedExecPolicyAmendment,
  proposedNetworkPolicyAmendments,
  requestPermissionProfileFromSandbox,
  requestedSandboxBypass,
  requiresUpfrontSandboxBypass,
  sandboxReadableRootsRetryApprovalKeys,
  sandboxRetryApprovalKeys,
  toolApprovalAvailableDecisions,
  ToolPolicyRejectedError,
  type NetworkRetryApprovalAnswer,
  type ToolApprovalRequirement,
} from './tool-orchestrator-policy.js';

export type ToolApprovalCoordinatorEvents =
  & RuntimeToolHookEvents
  & ToolApprovalLifecycleEvents;

export type ToolApprovalCoordinatorOptions = {
  toolHost: ToolHost;
  approvalGate?: ApprovalGate;
  approvalReviewer?: ApprovalReviewer;
  approvalReviewerMode?: RuntimeApprovalReviewer;
  approvalStore?: ToolApprovalStore;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  hookRunner?: RuntimeToolHookRunner | null;
  events: ToolApprovalCoordinatorEvents;
};

/**
 * Owns approval policy evaluation and grant persistence.
 * Tool execution and retry mechanics stay in ToolOrchestrator.
 */
export class ToolApprovalCoordinator {
  constructor(private readonly options: ToolApprovalCoordinatorOptions) {}

  async canRunWithoutApproval(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
  ): Promise<boolean> {
    const effective = effectiveToolCallFor(toolCall, parsedArguments);
    if (effective.rejectionReason) return false;
    const requirement = await this.approvalRequirement(
      effective.toolCall,
      effective.parsedArguments,
      context,
      approvalPolicy,
      context.environment,
    ).catch((): ToolApprovalRequirement => ({
      action: 'ask',
      reason: 'Approval check failed.',
      argumentsPreview: previewArguments(effective.parsedArguments),
    }));
    return requirement.action === 'skip';
  }

  async approveToolCall(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
    environment: ToolExecutionEnvironment,
    runtimeProfile?: ToolRuntimeProfile | null,
  ): Promise<RuntimeApprovalDecision> {
    const requirement = await this.approvalRequirement(
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
      environment,
      runtimeProfile,
    );
    if (requirement.action === 'skip') return 'approve';
    if (requirement.action === 'reject') {
      throw new ToolPolicyRejectedError(requirement.reason);
    }
    const approvalKeys = requirement.approvalKeys ?? [];
    const persistentApprovalKeys = requirement.persistentApprovalKeys ?? [];
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) return 'approve_for_session';
    if (await this.persistentApprovalIsRemembered(persistentApprovalKeys)) return 'approve';
    const approvalGate = this.options.approvalGate;
    if (!approvalGate) {
      throw new ToolPolicyRejectedError('Interactive approval is required, but no approval gate is available.');
    }
    const hookDecision = await this.options.hookRunner?.runPermissionRequest({
      approvalPolicy,
      context,
      environment,
      events: this.options.events,
      parsedArguments,
      toolCall,
    });
    if (hookDecision?.decision === 'allow') return 'approve';
    if (hookDecision?.decision === 'deny') {
      throw new ToolPolicyRejectedError(hookDecision.message);
    }

    const answer = await this.requestApproval(
      approvalGate,
      {
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        reason: requirement.reason,
        argumentsPreview: requirement.argumentsPreview,
        retryKind: requirement.retryKind,
        availableDecisions: toolApprovalAvailableDecisions(requirement),
        proposedExecPolicyAmendment: requirement.proposedExecPolicyAmendment,
        environmentId: requirement.environmentId,
        additionalPermissions: requirement.additionalPermissions,
      },
      parsedArguments,
      context,
    );

    if (answer.decision === 'reject' && answer.resolution?.source === 'automatic') {
      throw new ToolPolicyRejectedError(answer.message);
    }

    await this.persistExecPolicyAmendmentDecision(
      answer,
      requirement.proposedExecPolicyAmendment,
    );
    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    if (answer.decision === 'approve_persistently') {
      await this.options.persistentToolApprovalStore?.approve(persistentApprovalKeys);
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer.decision;
  }

  async approveNetworkAccessRetry(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
    reason: string,
    environment: ToolExecutionEnvironment,
    networkApprovalContext?: RuntimeNetworkApprovalContext | null,
    commandWideNetworkApproval = false,
  ): Promise<NetworkRetryApprovalAnswer> {
    if (approvalPolicy === 'full') return { decision: 'approve' };
    const approvalKeys = networkRetryApprovalKeys(
      toolCall,
      parsedArguments,
      context,
      networkApprovalContext,
    );
    if (this.options.approvalStore?.hasAny(approvalKeys, context.turnId)) {
      return { decision: 'approve_for_session' };
    }
    const approvalGate = this.options.approvalGate;
    if (!approvalGate) return { decision: 'reject' };

    const answer = await this.requestApproval(
      approvalGate,
      {
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        environmentId: environment.id,
        reason,
        argumentsPreview: networkApprovalContext && !commandWideNetworkApproval
          ? previewArguments({
              command: ['network-access', networkApprovalContext.target],
              network_approval_context: networkApprovalContext,
            })
          : previewArguments(parsedArguments),
        availableDecisions: networkApprovalAvailableDecisions(
          networkApprovalContext,
          commandWideNetworkApproval,
        ),
        ...(networkApprovalContext ? { networkApprovalContext } : {}),
        proposedNetworkPolicyAmendments: proposedNetworkPolicyAmendments(
          networkApprovalContext,
          commandWideNetworkApproval,
        ),
      },
      parsedArguments,
      context,
    );

    await this.persistNetworkPolicyAmendmentDecision(
      answer,
      networkApprovalContext,
      commandWideNetworkApproval,
    );
    if (
      decisionGrantsSessionReuse(answer.decision)
      && answer.networkPolicyAmendment?.action !== 'deny'
    ) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer;
  }

  async approveSandboxReadableRootsRetry(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
    reason: string,
    environment: ToolExecutionEnvironment,
    readableRoots: string[],
  ): Promise<ResolvedToolApprovalAnswer> {
    if (approvalPolicy === 'full') return { decision: 'approve' };
    const approvalKeys = sandboxReadableRootsRetryApprovalKeys(
      toolCall,
      parsedArguments,
      context,
      readableRoots,
    );
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) {
      return { decision: 'approve_for_session' };
    }
    const approvalGate = this.options.approvalGate;
    if (!approvalGate) return { decision: 'reject' };

    const answer = await this.requestApproval(
      approvalGate,
      {
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        environmentId: environment.id,
        reason,
        argumentsPreview: previewArguments(parsedArguments),
        additionalPermissions: requestPermissionProfileFromSandbox({ readableRoots }),
        availableDecisions: [
          { type: 'approve' },
          { type: 'approve_for_session' },
          { type: 'reject' },
        ],
      },
      parsedArguments,
      context,
    );

    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
      this.options.approvalStore?.grantSandboxPermissions(
        'session',
        context.turnId,
        environment.id,
        { readableRoots },
      );
    }
    return answer;
  }

  async approveSandboxBypassRetry(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    reason: string,
    environment: ToolExecutionEnvironment,
  ): Promise<ResolvedToolApprovalAnswer> {
    const approvalKeys = sandboxRetryApprovalKeys(toolCall, parsedArguments, context);
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) {
      return { decision: 'approve_for_session' };
    }
    const approvalGate = this.options.approvalGate;
    if (!approvalGate) return { decision: 'reject' };

    const answer = await this.requestApproval(
      approvalGate,
      {
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        environmentId: environment.id,
        reason,
        argumentsPreview: previewArguments(parsedArguments),
        retryKind: 'sandbox_bypass',
        availableDecisions: [
          { type: 'approve' },
          { type: 'approve_for_session' },
          { type: 'reject' },
        ],
      },
      parsedArguments,
      context,
    );

    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer;
  }

  private requestApproval(
    approvalGate: ApprovalGate,
    request: CreateApprovalInput,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
  ): Promise<ResolvedToolApprovalAnswer> {
    return requestToolApproval({
      approvalGate,
      automaticReview: { arguments: parsedArguments },
      automaticReviewer: this.options.approvalReviewer,
      events: this.options.events,
      request,
      reviewer: this.options.approvalReviewerMode ?? 'user',
      signal: context.signal,
    });
  }

  private async approvalRequirement(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
    environment: ToolExecutionEnvironment,
    knownRuntimeProfile?: ToolRuntimeProfile | null,
  ): Promise<ToolApprovalRequirement> {
    const strictAutoReview = this.options.approvalStore?.strictAutoReviewEnabled(context.turnId) ?? false;
    const fileRequirement = assessFileMutationApproval(
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
    );
    if (fileRequirement) return fileRequirement;
    const additionalPermissionRequirement = assessAdditionalSandboxPermissionsApproval(
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
      Boolean(this.options.approvalGate),
      environment,
    );
    if (additionalPermissionRequirement?.action === 'reject') {
      return additionalPermissionRequirement;
    }
    const requestsSandboxBypass = requestedSandboxBypass(toolCall.name, parsedArguments);
    if (
      requestsSandboxBypass
      && approvalPolicy === 'full'
      && context.permissionProfile !== 'danger-full-access'
    ) {
      return {
        action: 'reject',
        reason: '无需确认模式仍受工作区沙箱限制；无沙箱执行需要切换到“完全访问”或启用可交互审批。',
      };
    }
    const runtimeProfile = knownRuntimeProfile === undefined
      ? await this.options.toolHost.toolRuntimeProfile?.(toolCall.name, context)
      : knownRuntimeProfile;
    const needsUpfrontSandboxBypass = requiresUpfrontSandboxBypass(
      runtimeProfile,
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
    );
    if (additionalPermissionRequirement && !needsUpfrontSandboxBypass) {
      return additionalPermissionRequirement;
    }
    if (
      runtimeProfile?.approvalMode === 'selfManaged'
      && !requestsSandboxBypass
      && !needsUpfrontSandboxBypass
    ) {
      return { action: 'skip' };
    }
    // Full policy never prompts. Match Codex's Never policy by rejecting only
    // the narrow destructive-command denylist; ordinary approval hints are skipped.
    if (approvalPolicy === 'full' && !strictAutoReview) {
      const hostRequirement = await this.options.toolHost.approvalForTool?.(
        toolCall.name,
        parsedArguments,
        context,
      );
      return hostRequirement?.rejectWhenApprovalDisabled
        ? { action: 'reject', reason: hostRequirement.reason }
        : { action: 'skip' };
    }
    if (!this.options.approvalGate) {
      return requestsSandboxBypass || needsUpfrontSandboxBypass
        ? {
            action: 'reject',
            reason: 'Unsandboxed shell execution requires an interactive approval gate.',
          }
        : { action: 'skip' };
    }
    const execApprovalLookupKeys = execApprovalSessionLookupKeys(
      toolCall,
      parsedArguments,
      context,
    );
    if (
      !strictAutoReview
      && this.options.approvalStore?.hasAny(execApprovalLookupKeys, context.turnId)
    ) {
      return { action: 'skip' };
    }

    const hostRequirement = await this.options.toolHost.approvalForTool?.(
      toolCall.name,
      parsedArguments,
      context,
    );
    if (needsUpfrontSandboxBypass) {
      const additionalRequirement = additionalPermissionRequirement?.action === 'ask'
        ? additionalPermissionRequirement
        : null;
      const reasons = [
        hostRequirement?.reason,
        additionalRequirement?.reason,
        `The OS sandbox is unavailable on this platform. Approving ${toolCall.name} will run this command without the OS sandbox.`,
      ].filter((reason): reason is string => Boolean(reason));
      return {
        action: 'ask',
        reason: reasons.join(' '),
        argumentsPreview: hostRequirement?.argumentsPreview
          ?? additionalRequirement?.argumentsPreview
          ?? previewArguments(parsedArguments),
        approvalKeys: [...new Set([
          ...sandboxRetryApprovalKeys(toolCall, parsedArguments, context),
          ...(hostRequirement?.approvalKeys ?? []),
          ...(additionalRequirement?.approvalKeys ?? []),
        ])],
        environmentId: environment.id,
        additionalPermissions: additionalRequirement?.additionalPermissions,
        retryKind: 'sandbox_bypass',
      };
    }
    if (hostRequirement) {
      return {
        action: 'ask',
        reason: hostRequirement.reason,
        argumentsPreview: hostRequirement.argumentsPreview ?? previewArguments(parsedArguments),
        approvalKeys: hostRequirement.approvalKeys
          ?? execApprovalApprovalKeys(toolCall, parsedArguments, context),
        persistentApprovalKeys: hostRequirement.persistentApprovalKeys ?? [],
        proposedExecPolicyAmendment: proposedExecPolicyAmendment(toolCall, parsedArguments),
        environmentId: environment.id,
      };
    }
    if (strictAutoReview) {
      return {
        action: 'ask',
        reason: `Strict auto review requires confirmation before running ${toolCall.name}.`,
        argumentsPreview: previewArguments(parsedArguments),
        environmentId: environment.id,
      };
    }
    if (approvalPolicy === 'strict') {
      return {
        action: 'ask',
        reason: `Strict approval policy requires confirmation before running ${toolCall.name}.`,
        argumentsPreview: previewArguments(parsedArguments),
        environmentId: environment.id,
      };
    }
    return { action: 'skip' };
  }

  private async persistExecPolicyAmendmentDecision(
    answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>,
    fallback?: RuntimeExecPolicyAmendment,
  ): Promise<void> {
    if (answer.decision !== 'approve_exec_policy_amendment') return;
    const amendment = answer.proposedExecPolicyAmendment?.length
      ? answer.proposedExecPolicyAmendment
      : fallback;
    if (amendment?.length) {
      await this.options.policyAmendmentStore?.appendExecPolicyAmendment(amendment);
    }
  }

  private async persistNetworkPolicyAmendmentDecision(
    answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>,
    networkApprovalContext?: RuntimeNetworkApprovalContext | null,
    commandWideNetworkApproval = false,
  ): Promise<void> {
    if (answer.decision !== 'approve_network_policy_amendment') return;
    const amendments = proposedNetworkPolicyAmendments(
      networkApprovalContext,
      commandWideNetworkApproval,
    );
    const fallbackAction = commandWideNetworkApproval ? 'deny' : 'allow';
    const requested = answer.networkPolicyAmendment
      ?? amendments?.find((item) => item.action === fallbackAction);
    const amendment = amendments?.find(
      (item) => item.host === requested?.host && item.action === requested?.action,
    );
    if (amendment) {
      await this.options.policyAmendmentStore?.appendNetworkPolicyAmendment(
        amendment,
        networkApprovalContext?.protocol,
      );
    }
  }

  private async persistentApprovalIsRemembered(keys: string[]): Promise<boolean> {
    return Boolean(
      keys.length
      && await this.options.persistentToolApprovalStore?.hasAll(keys),
    );
  }
}
