import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeConfigState,
  RuntimeExecPolicyAmendment,
  RuntimeHookRun,
  RuntimePermissionGrantResponse,
  RuntimePluginReference,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type { RuntimeToolHookRunner } from '../../hooks/runtime-hooks.js';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { Clock } from '../../ports/clock.js';
import type { PersistentToolApprovalStore } from '../../ports/persistent-tool-approval-store.js';
import type { PolicyAmendmentStore } from '../../ports/policy-amendment-store.js';
import {
  ToolExecutionError,
  type RuntimeToolExecutionContext,
  type ToolExecutionEnvironment,
  type ToolExecutionResult,
  type ToolHost,
  type ToolOutputDelta,
} from '../../ports/tool-host.js';
import { FILE_MUTATION_TOOL_NAMES } from '../../security/file-system-policy.js';
import {
  networkApprovalContextFromTool,
  type RuntimeNetworkApprovalContext,
} from '../../security/network-approval-policy.js';
import { isAbortError, throwIfAborted } from '../core/runtime-turn-errors.js';
import { ToolApprovalStore } from './tool-approval-store.js';
import type {
  NetworkRetryApprovalAnswer,
  ToolApprovalRequirement
} from './tool-orchestrator-policy.js';
import {
  abortable,
  additionalSandboxPermissionsForTool,
  appendHookAdditionalContexts,
  applyHookUpdatedInput,
  assessAdditionalSandboxPermissionsApproval,
  assessFileMutationApproval,
  decisionGrantsSessionReuse,
  effectiveToolCallFor,
  emptyRequestPermissionProfile,
  environmentIdForContext,
  execApprovalApprovalKeys,
  execApprovalSessionLookupKeys,
  isEmptySandboxWorkspaceWrite,
  isShellCommandToolName,
  mergeSandboxWorkspaceWrite,
  networkApprovalAvailableDecisions,
  networkApprovalContextFromToolError,
  networkPolicyDeniedError,
  networkRetryApprovalKeys,
  previewArguments,
  proposedExecPolicyAmendment,
  proposedNetworkPolicyAmendments,
  REQUEST_PERMISSIONS_TOOL_NAME,
  requestedSandboxBypass,
  requestPermissionProfileFromSandbox,
  requestPermissionResponseForDecision,
  requestPermissionsApprovalKeys,
  requestPermissionsGrantForTool,
  sandboxReadableRootsRetryApprovalKeys,
  sandboxRetryApprovalKeys,
  suggestedSandboxReadableRoots,
  throwIfApprovalCancelled,
  toolApprovalAvailableDecisions,
  ToolPolicyRejectedError,
  toolRunWithCancellationProfile
} from './tool-orchestrator-policy.js';

export { FILE_MUTATION_TOOL_NAMES };

export type ToolOrchestratorEvents = {
  publishToolStarted(toolCall: RuntimeToolCall, parsedArguments: unknown, resultPreview?: string, plugin?: RuntimePluginReference): Promise<void>;
  publishToolCompleted(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    status: 'success' | 'error' | 'rejected',
    content: string,
    metadata?: { data?: unknown; resultPreview?: string; startedAtMs?: number },
  ): Promise<void>;
  publishToolOutputDelta(toolCall: RuntimeToolCall, delta: ToolOutputDelta): Promise<void>;
  publishHookStarted(run: RuntimeHookRun): Promise<void>;
  publishHookCompleted(run: RuntimeHookRun): Promise<void>;
  publishApprovalRequested(approval: RuntimeApprovalRequest): Promise<void>;
  publishApprovalResolved(approvalId: string, decision: RuntimeApprovalDecision, message?: string, createdAt?: string): Promise<void>;
};

export type ToolOrchestratorOptions = {
  toolHost: ToolHost;
  approvalGate?: ApprovalGate;
  approvalStore?: ToolApprovalStore;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  hookRunner?: RuntimeToolHookRunner | null;
  clock: Clock;
  events: ToolOrchestratorEvents;
};

export type ToolOrchestratorRunOptions = {
  checkApproval?: boolean;
  plugin?: RuntimePluginReference;
  postProcessResult?(result: ToolExecutionResult): Promise<ToolExecutionResult>;
  waitsForRuntimeCancellation?: boolean;
};

export type ToolOrchestratorRunResult = {
  content: string;
  processed: boolean;
  result?: ToolExecutionResult;
  status: 'success' | 'error' | 'rejected';
};

/**
 * 集中处理工具执行的 runtime 侧流程：预览、审批、执行、输出流和完成事件。
 * 保持现有编排边界，同时确保 Setsuna 当前事件协议稳定。
 */
export class ToolOrchestrator {
  constructor(private readonly options: ToolOrchestratorOptions) {}

  async canRunWithoutApproval(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy']): Promise<boolean> {
    const effective = effectiveToolCallFor(toolCall, parsedArguments);
    if (effective.rejectionReason) return false;
    const requirement = await this.approvalRequirement(effective.toolCall, effective.parsedArguments, context, approvalPolicy, context.environment).catch((): ToolApprovalRequirement => ({
      action: 'ask',
      reason: 'Approval check failed.',
      argumentsPreview: previewArguments(effective.parsedArguments),
    }));
    return requirement.action === 'skip';
  }

  async runToolCall(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy'], runOptions: ToolOrchestratorRunOptions = {}): Promise<ToolOrchestratorRunResult> {
    const effective = effectiveToolCallFor(toolCall, parsedArguments);
    let runToolCall = effective.toolCall;
    let runArguments = effective.parsedArguments;
    const environment = context.environment;
    const stepContext = context;
    if (runToolCall.name === REQUEST_PERMISSIONS_TOOL_NAME) {
      return this.runRequestPermissionsTool(runToolCall, runArguments, stepContext, approvalPolicy, environment);
    }
    const additionalSandboxPermissions = additionalSandboxPermissionsForTool(runToolCall, runArguments, stepContext, environment);
    let content = '';
    let processed = false;
    let startResultPreview: string | undefined;
    let expectedPreviewIntegrityToken: string | undefined;
    let startedAtMs: number | undefined;
    const outputDeltaPublishes: Promise<void>[] = [];
    let acceptingOutputDeltas = true;
    let preHookAdditionalContexts: string[] = [];

    try {
      throwIfAborted(stepContext.signal);
      const preHookOutcome = effective.rejectionReason
        ? null
        : await this.options.hookRunner?.runPreToolUse({
          approvalPolicy,
          context: stepContext,
          environment,
          events: this.hookEvents(),
          parsedArguments: runArguments,
          toolCall: runToolCall,
        });
      if (preHookOutcome?.action === 'block') {
        throw new ToolPolicyRejectedError(preHookOutcome.reason);
      }
      if (preHookOutcome?.additionalContexts.length) {
        preHookAdditionalContexts = preHookOutcome.additionalContexts;
      }
      if (preHookOutcome?.action === 'continue' && preHookOutcome.updatedInput !== undefined) {
        runArguments = applyHookUpdatedInput(runToolCall.name, runArguments, preHookOutcome.updatedInput);
        runToolCall = { ...runToolCall, arguments: JSON.stringify(runArguments) };
      }
      const startPreview = effective.rejectionReason
        ? null
        : await this.options.toolHost.previewToolCall?.(runToolCall.name, runArguments, stepContext).catch(() => null);
      startResultPreview = startPreview?.resultPreview;
      expectedPreviewIntegrityToken = startPreview?.integrityToken;
      startedAtMs = this.options.clock.now().getTime();
      await this.options.events.publishToolStarted(runToolCall, runArguments, startResultPreview, runOptions.plugin);

      if (effective.rejectionReason) {
        throw new ToolPolicyRejectedError(effective.rejectionReason);
      }

      const approval = runOptions.checkApproval === false ? 'approve' : await this.approveToolCall(runToolCall, runArguments, stepContext, approvalPolicy, environment);
      if (approval === 'reject') {
        content = `Tool ${runToolCall.name} was rejected.`;
        await this.options.events.publishToolCompleted(runToolCall, runArguments, 'rejected', content, {
          resultPreview: startResultPreview,
          startedAtMs,
        });
        return { content, processed, status: 'rejected' };
      }

      throwIfAborted(stepContext.signal);
      const sandboxWorkspaceWrite = this.sandboxWorkspaceWriteForRun(stepContext, additionalSandboxPermissions?.sandboxWorkspaceWrite);
      const networkAccessApprovedForSession = this.options.approvalStore?.hasAny(networkRetryApprovalKeys(runToolCall, runArguments, stepContext), stepContext.turnId) ?? false;
      const fullAccess = approvalPolicy === 'full' && stepContext.permissionProfile === 'danger-full-access';
      const firstRunSandbox = fullAccess || requestedSandboxBypass(runToolCall.name, runArguments)
        ? {
            mode: 'bypass' as const,
            retryReason: fullAccess
              ? 'Full access mode disables the OS sandbox.'
              : 'Command requested escalated sandbox permissions.',
          }
        : { mode: 'default' as const };
      const toolRunContext: RuntimeToolExecutionContext = {
        ...stepContext,
        sandboxWorkspaceWrite,
        sandbox: {
          ...firstRunSandbox,
          ...(sandboxWorkspaceWrite.networkAccess === true || networkAccessApprovedForSession
            ? {
                networkAccess: 'enabled' as const,
                retryReason: 'Network access was previously approved for this session.',
              }
            : {}),
        },
        toolCallId: runToolCall.id,
        expectedPreviewIntegrityToken,
        onToolOutputDelta: (delta) => {
          if (!acceptingOutputDeltas) return;
          const publish = this.options.events.publishToolOutputDelta(runToolCall, delta).catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const toolRun = this.options.toolHost.runTool(runToolCall.name, runArguments, toolRunContext);
      const result = await toolRunWithCancellationProfile(toolRun, stepContext.signal, runOptions.waitsForRuntimeCancellation !== false);
      acceptingOutputDeltas = false;
      processed = true;
      return await this.completeSuccessfulToolRun({
        approvalPolicy,
        context: stepContext,
        environment,
        outputDeltaPublishes,
        parsedArguments: runArguments,
        preHookAdditionalContexts,
        result,
        runOptions,
        startedAtMs,
        toolCall: runToolCall,
      });
    } catch (error) {
      acceptingOutputDeltas = false;
      if (isAbortError(error)) throw error;
      if (error instanceof ToolExecutionError && (error.failureKind === 'sandbox_denied' || error.failureKind === 'sandbox_unavailable')) {
        const retry = await this.retryAfterSandboxDenied({
          approvalPolicy,
          context: stepContext,
          environment,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          resultPreview: startResultPreview,
          startedAtMs,
          toolCall: runToolCall,
          toolError: error,
          expectedPreviewIntegrityToken,
          preHookAdditionalContexts,
          runOptions,
        });
        if (retry) return retry;
      }
      if (error instanceof ToolExecutionError && error.failureKind === 'network_denied') {
        const retry = await this.retryAfterNetworkDenied({
          approvalPolicy,
          context: stepContext,
          environment,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          resultPreview: startResultPreview,
          startedAtMs,
          toolCall: runToolCall,
          toolError: error,
          expectedPreviewIntegrityToken,
          preHookAdditionalContexts,
          runOptions,
        });
        if (retry) return retry;
      }
      if (error instanceof ToolPolicyRejectedError) {
        content = `Tool ${runToolCall.name} was rejected by runtime policy: ${error.message}`;
        await Promise.all(outputDeltaPublishes);
        await this.options.events.publishToolCompleted(runToolCall, runArguments, 'rejected', content, {
          resultPreview: startResultPreview,
          startedAtMs,
        });
        return { content, processed, status: 'rejected' };
      }
      processed = true;
      content = `Tool ${runToolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(runToolCall, runArguments, 'error', content, {
        resultPreview: startResultPreview,
        startedAtMs,
      });
      return { content, processed, status: 'error' };
    }
  }

  private async runRequestPermissionsTool(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy'], environment: ToolExecutionEnvironment): Promise<ToolOrchestratorRunResult> {
    const startedAtMs = this.options.clock.now().getTime();
    await this.options.events.publishToolStarted(toolCall, parsedArguments);
    if (context.features?.request_permissions_tool === false) {
      const response = {
        permissions: emptyRequestPermissionProfile(),
        scope: 'turn' as const,
        strict_auto_review: false,
      };
      const content = JSON.stringify(response);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'success', content, {
        data: response,
        resultPreview: content,
        startedAtMs,
      });
      return {
        content,
        processed: true,
        result: { content, data: response, preview: content },
        status: 'success',
      };
    }
    const request = requestPermissionsGrantForTool(toolCall, parsedArguments, context, environment);

    if (request.rejectionReason) {
      const content = `Tool ${toolCall.name} was rejected by runtime policy: ${request.rejectionReason}`;
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'rejected', content, { startedAtMs });
      return { content, processed: false, status: 'rejected' };
    }

    let decision: RuntimeApprovalDecision = 'approve';
    let permissionGrant: RuntimePermissionGrantResponse | undefined;
    if (isEmptySandboxWorkspaceWrite(request.sandboxWorkspaceWrite)) {
      decision = 'reject';
    } else if (approvalPolicy === 'full') {
      decision = 'approve';
    } else if (!this.options.approvalGate) {
      decision = 'reject';
    } else {
      const approval = await this.options.approvalGate.createApproval({
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        reason: request.reason,
        argumentsPreview: previewArguments({
          reason: request.requestReason,
          permissions: request.requestedPermissions,
          grant: request.grantedPermissions,
        }),
        availableDecisions: [
          { type: 'approve' },
          { type: 'approve_for_turn_with_strict_auto_review' },
          { type: 'approve_for_session' },
          { type: 'reject' },
        ],
        permissionApprovalContext: {
          availableScopes: ['turn', 'session'],
          cwd: request.cwd,
          environmentId: request.environmentId,
          grantedPermissions: request.grantedPermissions,
          reason: request.requestReason,
          requestedPermissions: request.requestedPermissions,
        },
      });
      await this.options.events.publishApprovalRequested(approval);

      try {
        const answer = await abortable(this.options.approvalGate.waitForDecision(approval.id), context.signal);
        decision = answer.decision;
        permissionGrant = answer.permissionGrant;
        await this.options.events.publishApprovalResolved(approval.id, answer.decision, answer.message);
      } catch (error) {
        if (isAbortError(error)) {
          const resolved = await this.options.approvalGate.answerApproval(approval.id, {
            decision: 'cancel',
            message: 'Turn cancelled.',
          });
          await this.options.events.publishApprovalResolved(approval.id, 'cancel', 'Turn cancelled.', resolved.resolvedAt);
        }
        throw error;
      }
      throwIfApprovalCancelled(decision);
    }

    const permissionResponse = requestPermissionResponseForDecision(decision, permissionGrant, request, context, environment);
    const response = {
      permissions: permissionResponse.permissions,
      scope: permissionResponse.scope,
      strict_auto_review: permissionResponse.strictAutoReview,
    };

    if (!isEmptySandboxWorkspaceWrite(permissionResponse.sandboxWorkspaceWrite)) {
      const approvalKeys = requestPermissionsApprovalKeys(request.environmentId, permissionResponse.permissions);
      if (permissionResponse.scope === 'session') {
        this.options.approvalStore?.approveForSession(approvalKeys);
      } else {
        this.options.approvalStore?.approveForTurn(context.turnId, approvalKeys);
        if (permissionResponse.strictAutoReview) this.options.approvalStore?.enableStrictAutoReviewForTurn(context.turnId);
      }
      this.options.approvalStore?.grantSandboxPermissions(permissionResponse.scope, context.turnId, request.environmentId, permissionResponse.sandboxWorkspaceWrite);
    }

    const content = JSON.stringify(response);
    await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'success', content, {
      data: response,
      resultPreview: content,
      startedAtMs,
    });
    return {
      content,
      processed: true,
      result: { content, data: response, preview: content },
      status: 'success',
    };
  }

  private sandboxWorkspaceWriteForRun(context: RuntimeToolExecutionContext, extra: RuntimeSandboxWorkspaceWrite | undefined): RuntimeSandboxWorkspaceWrite {
    return mergeSandboxWorkspaceWrite(
      mergeSandboxWorkspaceWrite(
        context.sandboxWorkspaceWrite,
        this.options.approvalStore?.sandboxWorkspaceWriteFor(context.turnId, environmentIdForContext(context)),
      ),
      extra,
    );
  }

  private hookEvents() {
    return {
      publishHookStarted: (run: RuntimeHookRun) => this.options.events.publishHookStarted(run),
      publishHookCompleted: (run: RuntimeHookRun) => this.options.events.publishHookCompleted(run),
    };
  }

  /** All fallible success-side work must finish before the single terminal event is published. */
  private async completeSuccessfulToolRun({
    approvalPolicy,
    context,
    environment,
    outputDeltaPublishes,
    parsedArguments,
    preHookAdditionalContexts,
    result: rawResult,
    runOptions,
    startedAtMs,
    toolCall,
  }: {
    approvalPolicy: RuntimeConfigState['approvalPolicy'];
    context: RuntimeToolExecutionContext;
    environment: ToolExecutionEnvironment;
    outputDeltaPublishes: Promise<void>[];
    parsedArguments: unknown;
    preHookAdditionalContexts: string[];
    result: ToolExecutionResult;
    runOptions: ToolOrchestratorRunOptions;
    startedAtMs?: number;
    toolCall: RuntimeToolCall;
  }): Promise<ToolOrchestratorRunResult> {
    throwIfAborted(context.signal);
    const result = runOptions.postProcessResult
      ? await runOptions.postProcessResult(rawResult)
      : rawResult;
    throwIfAborted(context.signal);

    let content = result.content;
    const postHookOutcome = await this.options.hookRunner?.runPostToolUse({
      approvalPolicy,
      context,
      environment,
      events: this.hookEvents(),
      parsedArguments,
      result,
      toolCall,
    });
    const modelVisibleHookFeedback = postHookOutcome?.feedbackMessage
      ?? (postHookOutcome?.shouldBlock ? 'PostToolUse hook blocked the tool result.' : undefined);
    if (modelVisibleHookFeedback) content = modelVisibleHookFeedback;
    const hookAdditionalContexts = [...preHookAdditionalContexts, ...(postHookOutcome?.additionalContexts ?? [])];
    if (hookAdditionalContexts.length) {
      content = appendHookAdditionalContexts(content, hookAdditionalContexts);
    }
    await Promise.all(outputDeltaPublishes);
    await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'success', result.preview ?? content, {
      data: result.data,
      resultPreview: result.preview,
      startedAtMs,
    });
    return { content, processed: true, result, status: 'success' };
  }

  private async retryAfterNetworkDenied({
    approvalPolicy,
    context,
    environment,
    outputDeltaPublishes,
    parsedArguments,
    resultPreview,
    startedAtMs,
    toolCall,
    toolError,
    expectedPreviewIntegrityToken,
    preHookAdditionalContexts,
    runOptions,
  }: {
    approvalPolicy: RuntimeConfigState['approvalPolicy'];
    context: RuntimeToolExecutionContext;
    environment: ToolExecutionEnvironment;
    outputDeltaPublishes: Promise<void>[];
    parsedArguments: unknown;
    resultPreview?: string;
    startedAtMs?: number;
    toolCall: RuntimeToolCall;
    toolError: ToolExecutionError;
    expectedPreviewIntegrityToken?: string;
    preHookAdditionalContexts: string[];
    runOptions: ToolOrchestratorRunOptions;
  }): Promise<ToolOrchestratorRunResult | null> {
    const networkApprovalContext = networkApprovalContextFromToolError(toolError) ?? networkApprovalContextFromTool(toolCall.name, parsedArguments);
    const commandWideNetworkApproval = isShellCommandToolName(toolCall.name);
    if (networkPolicyDeniedError(toolError)) {
      const content = `Tool ${toolCall.name} was blocked by persistent network policy: ${toolError.message}`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }
    const retryReason = commandWideNetworkApproval
      ? `Network access applies to the entire command and grants process-wide capability. Review and approve this exact command before retrying.`
      : networkApprovalContext
      ? `Network access to "${networkApprovalContext.target}" is blocked by policy. Approve retry with network access.`
      : `Network access is blocked for ${toolCall.name}: ${toolError.message}. Approve retry with network access.`;
    const approvalAnswer = await this.approveNetworkAccessRetry(
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
      const content = `Tool ${toolCall.name} network retry was rejected.`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'rejected', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: false, status: 'rejected' };
    }
    if (approvalAnswer.decision === 'approve_network_policy_amendment' && approvalAnswer.networkPolicyAmendment?.action === 'deny') {
      const target = approvalAnswer.networkPolicyAmendment.host || networkApprovalContext?.target || 'requested network target';
      const content = `Tool ${toolCall.name} network access was denied by persistent network policy for ${target}.`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }

    let acceptingOutputDeltas = true;
    try {
      throwIfAborted(context.signal);
      const retrySandbox = requestedSandboxBypass(toolCall.name, parsedArguments)
        ? { mode: 'bypass' as const, networkAccess: 'enabled' as const, retryReason }
        : { mode: 'default' as const, networkAccess: 'enabled' as const, retryReason };
      const retryContext: RuntimeToolExecutionContext = {
        ...context,
        sandboxWorkspaceWrite: this.sandboxWorkspaceWriteForRun(context, additionalSandboxPermissionsForTool(toolCall, parsedArguments, context, environment)?.sandboxWorkspaceWrite),
        sandbox: retrySandbox,
        toolCallId: toolCall.id,
        expectedPreviewIntegrityToken,
        onToolOutputDelta: (delta) => {
          if (!acceptingOutputDeltas) return;
          const publish = this.options.events.publishToolOutputDelta(toolCall, delta).catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const toolRun = this.options.toolHost.runTool(toolCall.name, parsedArguments, retryContext);
      const result = await toolRunWithCancellationProfile(toolRun, context.signal, runOptions.waitsForRuntimeCancellation !== false);
      acceptingOutputDeltas = false;
      return await this.completeSuccessfulToolRun({
        approvalPolicy,
        context,
        environment,
        outputDeltaPublishes,
        parsedArguments,
        preHookAdditionalContexts,
        result,
        runOptions,
        startedAtMs,
        toolCall,
      });
    } catch (retryError) {
      acceptingOutputDeltas = false;
      if (isAbortError(retryError)) throw retryError;
      const content = `Tool ${toolCall.name} failed after network retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }
  }

  private async retryAfterSandboxDenied({
    approvalPolicy,
    context,
    environment,
    outputDeltaPublishes,
    parsedArguments,
    resultPreview,
    startedAtMs,
    toolCall,
    toolError,
    expectedPreviewIntegrityToken,
    preHookAdditionalContexts,
    runOptions,
  }: {
    approvalPolicy: RuntimeConfigState['approvalPolicy'];
    context: RuntimeToolExecutionContext;
    environment: ToolExecutionEnvironment;
    outputDeltaPublishes: Promise<void>[];
    parsedArguments: unknown;
    resultPreview?: string;
    startedAtMs?: number;
    toolCall: RuntimeToolCall;
    toolError: ToolExecutionError;
    expectedPreviewIntegrityToken?: string;
    preHookAdditionalContexts: string[];
    runOptions: ToolOrchestratorRunOptions;
  }): Promise<ToolOrchestratorRunResult | null> {
    const suggestedReadableRoots = suggestedSandboxReadableRoots(toolError, context);
    if (suggestedReadableRoots.length) {
      const narrowReason = `Sandbox could not read the resolved toolchain for ${toolCall.name}. Approve read-only access to: ${suggestedReadableRoots.join(', ')}.`;
      const narrowDecision = await this.approveSandboxReadableRootsRetry(
        toolCall,
        parsedArguments,
        context,
        approvalPolicy,
        narrowReason,
        environment,
        suggestedReadableRoots,
      );
      if (narrowDecision === 'reject') {
        const content = `Tool ${toolCall.name} sandbox readable-root retry was rejected.`;
        await Promise.all(outputDeltaPublishes);
        await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'rejected', content, {
          resultPreview,
          startedAtMs,
        });
        return { content, processed: false, status: 'rejected' };
      }

      let acceptingNarrowOutputDeltas = true;
      try {
        throwIfAborted(context.signal);
        const narrowSandboxWorkspaceWrite = this.sandboxWorkspaceWriteForRun(context, {
          readableRoots: suggestedReadableRoots,
        });
        const narrowContext: RuntimeToolExecutionContext = {
          ...context,
          sandboxWorkspaceWrite: narrowSandboxWorkspaceWrite,
          sandbox: { mode: 'default', retryReason: narrowReason },
          toolCallId: toolCall.id,
          expectedPreviewIntegrityToken,
          onToolOutputDelta: (delta) => {
            if (!acceptingNarrowOutputDeltas) return;
            const publish = this.options.events.publishToolOutputDelta(toolCall, delta).catch(() => undefined);
            outputDeltaPublishes.push(publish);
          },
        };
        const result = await toolRunWithCancellationProfile(
          this.options.toolHost.runTool(toolCall.name, parsedArguments, narrowContext),
          context.signal,
          runOptions.waitsForRuntimeCancellation !== false,
        );
        acceptingNarrowOutputDeltas = false;
        return await this.completeSuccessfulToolRun({
          approvalPolicy,
          context,
          environment,
          outputDeltaPublishes,
          parsedArguments,
          preHookAdditionalContexts,
          result,
          runOptions,
          startedAtMs,
          toolCall,
        });
      } catch (narrowError) {
        acceptingNarrowOutputDeltas = false;
        if (isAbortError(narrowError)) throw narrowError;
        if (!(narrowError instanceof ToolExecutionError) || narrowError.failureKind !== 'sandbox_denied') {
          const content = `Tool ${toolCall.name} failed after sandbox readable-root retry: ${narrowError instanceof Error ? narrowError.message : String(narrowError)}`;
          await Promise.all(outputDeltaPublishes);
          await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
            resultPreview,
            startedAtMs,
          });
          return { content, processed: true, status: 'error' };
        }
        toolError = narrowError;
      }
    }

    // “无需确认”只关闭审批交互，不得自动扩大为无沙箱执行。真正的完全访问会在
    // 首次执行时使用 danger-full-access，因此不会走到这里。
    if (approvalPolicy === 'full' && context.permissionProfile !== 'danger-full-access') {
      const content = `Tool ${toolCall.name} was denied by the OS sandbox. No unsandboxed retry was attempted because the current mode disables prompts but keeps workspace sandboxing.`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }

    const retryReason = `Sandbox denied ${toolCall.name}: ${toolError.message}. Approve retry without the OS sandbox.`;
    const decision = await this.approveSandboxBypassRetry(toolCall, parsedArguments, context, retryReason, environment);
    if (decision === 'reject') {
      const content = `Tool ${toolCall.name} sandbox retry was rejected.`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'rejected', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: false, status: 'rejected' };
    }

    let acceptingOutputDeltas = true;
    try {
      throwIfAborted(context.signal);
      const retryContext: RuntimeToolExecutionContext = {
        ...context,
        sandboxWorkspaceWrite: this.sandboxWorkspaceWriteForRun(context, additionalSandboxPermissionsForTool(toolCall, parsedArguments, context, environment)?.sandboxWorkspaceWrite),
        sandbox: { mode: 'bypass', retryReason },
        toolCallId: toolCall.id,
        expectedPreviewIntegrityToken,
        onToolOutputDelta: (delta) => {
          if (!acceptingOutputDeltas) return;
          const publish = this.options.events.publishToolOutputDelta(toolCall, delta).catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const toolRun = this.options.toolHost.runTool(toolCall.name, parsedArguments, retryContext);
      const result = await toolRunWithCancellationProfile(toolRun, context.signal, runOptions.waitsForRuntimeCancellation !== false);
      acceptingOutputDeltas = false;
      return await this.completeSuccessfulToolRun({
        approvalPolicy,
        context,
        environment,
        outputDeltaPublishes,
        parsedArguments,
        preHookAdditionalContexts,
        result,
        runOptions,
        startedAtMs,
        toolCall,
      });
    } catch (retryError) {
      acceptingOutputDeltas = false;
      if (isAbortError(retryError)) throw retryError;
      const content = `Tool ${toolCall.name} failed after sandbox retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }
  }

  private async approveNetworkAccessRetry(
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
    const approvalKeys = networkRetryApprovalKeys(toolCall, parsedArguments, context, networkApprovalContext);
    if (this.options.approvalStore?.hasAny(approvalKeys, context.turnId)) return { decision: 'approve_for_session' };
    if (!this.options.approvalGate) return { decision: 'reject' };
    const approval = await this.options.approvalGate.createApproval({
      threadId: context.threadId,
      turnId: context.turnId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      environmentId: environment.id,
      reason,
      argumentsPreview: networkApprovalContext && !commandWideNetworkApproval
        ? previewArguments({ command: ['network-access', networkApprovalContext.target], network_approval_context: networkApprovalContext })
        : previewArguments(parsedArguments),
      availableDecisions: networkApprovalAvailableDecisions(networkApprovalContext, commandWideNetworkApproval),
      ...(networkApprovalContext ? { networkApprovalContext } : {}),
      proposedNetworkPolicyAmendments: proposedNetworkPolicyAmendments(networkApprovalContext, commandWideNetworkApproval),
    });
    await this.options.events.publishApprovalRequested(approval);

    let answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>;
    try {
      answer = await abortable(this.options.approvalGate.waitForDecision(approval.id), context.signal);
    } catch (error) {
      if (isAbortError(error)) {
        const resolved = await this.options.approvalGate.answerApproval(approval.id, {
          decision: 'cancel',
          message: 'Turn cancelled.',
        });
        await this.options.events.publishApprovalResolved(approval.id, 'cancel', 'Turn cancelled.', resolved.resolvedAt);
      }
      throw error;
    }

    await this.options.events.publishApprovalResolved(approval.id, answer.decision, answer.message);
    throwIfApprovalCancelled(answer.decision);
    await this.persistNetworkPolicyAmendmentDecision(answer, networkApprovalContext, commandWideNetworkApproval);
    if (decisionGrantsSessionReuse(answer.decision) && answer.networkPolicyAmendment?.action !== 'deny') {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer;
  }

  private async approveSandboxReadableRootsRetry(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    approvalPolicy: RuntimeConfigState['approvalPolicy'],
    reason: string,
    environment: ToolExecutionEnvironment,
    readableRoots: string[],
  ): Promise<RuntimeApprovalDecision> {
    if (approvalPolicy === 'full') return 'approve';
    const approvalKeys = sandboxReadableRootsRetryApprovalKeys(toolCall, parsedArguments, context, readableRoots);
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) return 'approve_for_session';
    if (!this.options.approvalGate) return 'reject';
    const approval = await this.options.approvalGate.createApproval({
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
    });
    await this.options.events.publishApprovalRequested(approval);
    const answer = await this.waitForApprovalDecision(approval.id, context);
    await this.options.events.publishApprovalResolved(approval.id, answer.decision, answer.message);
    throwIfApprovalCancelled(answer.decision);
    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
      this.options.approvalStore?.grantSandboxPermissions('session', context.turnId, environment.id, { readableRoots });
    }
    return answer.decision;
  }

  private async approveSandboxBypassRetry(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, reason: string, environment: ToolExecutionEnvironment): Promise<RuntimeApprovalDecision> {
    const approvalKeys = sandboxRetryApprovalKeys(toolCall, parsedArguments, context);
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) return 'approve_for_session';
    if (!this.options.approvalGate) return 'reject';
    const approval = await this.options.approvalGate.createApproval({
      threadId: context.threadId,
      turnId: context.turnId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      environmentId: environment.id,
      reason,
      argumentsPreview: previewArguments(parsedArguments),
      availableDecisions: [
        { type: 'approve' },
        { type: 'approve_for_session' },
        { type: 'reject' },
      ],
    });
    await this.options.events.publishApprovalRequested(approval);

    const answer = await this.waitForApprovalDecision(approval.id, context);

    await this.options.events.publishApprovalResolved(approval.id, answer.decision, answer.message);
    throwIfApprovalCancelled(answer.decision);
    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer.decision;
  }

  private async waitForApprovalDecision(approvalId: string, context: RuntimeToolExecutionContext): Promise<Awaited<ReturnType<ApprovalGate['waitForDecision']>>> {
    if (!this.options.approvalGate) throw new Error('Approval gate is unavailable.');
    try {
      return await abortable(this.options.approvalGate.waitForDecision(approvalId), context.signal);
    } catch (error) {
      if (isAbortError(error)) {
        const resolved = await this.options.approvalGate.answerApproval(approvalId, {
          decision: 'cancel',
          message: 'Turn cancelled.',
        });
        await this.options.events.publishApprovalResolved(approvalId, 'cancel', 'Turn cancelled.', resolved.resolvedAt);
      }
      throw error;
    }
  }

  private async approveToolCall(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy'], environment: ToolExecutionEnvironment): Promise<RuntimeApprovalDecision> {
    const requirement = await this.approvalRequirement(toolCall, parsedArguments, context, approvalPolicy, environment);
    if (requirement.action === 'skip') return 'approve';
    if (requirement.action === 'reject') {
      throw new ToolPolicyRejectedError(requirement.reason);
    }
    const approvalKeys = requirement.approvalKeys ?? [];
    const persistentApprovalKeys = requirement.persistentApprovalKeys ?? [];
    if (this.options.approvalStore?.hasAll(approvalKeys, context.turnId)) return 'approve_for_session';
    if (await this.persistentApprovalIsRemembered(persistentApprovalKeys)) return 'approve';
    if (!this.options.approvalGate) return 'approve';
    const hookDecision = await this.options.hookRunner?.runPermissionRequest({
      approvalPolicy,
      context,
      environment,
      events: this.hookEvents(),
      parsedArguments,
      toolCall,
    });
    if (hookDecision?.decision === 'allow') return 'approve';
    if (hookDecision?.decision === 'deny') {
      throw new ToolPolicyRejectedError(hookDecision.message);
    }

    const approval = await this.options.approvalGate.createApproval({
      threadId: context.threadId,
      turnId: context.turnId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      reason: requirement.reason,
      argumentsPreview: requirement.argumentsPreview,
      availableDecisions: toolApprovalAvailableDecisions(requirement),
      proposedExecPolicyAmendment: requirement.proposedExecPolicyAmendment,
      environmentId: requirement.environmentId,
      additionalPermissions: requirement.additionalPermissions,
    });
    await this.options.events.publishApprovalRequested(approval);

    let answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>;
    try {
      answer = await abortable(this.options.approvalGate.waitForDecision(approval.id), context.signal);
    } catch (error) {
      if (isAbortError(error)) {
        const resolved = await this.options.approvalGate.answerApproval(approval.id, {
          decision: 'cancel',
          message: 'Turn cancelled.',
        });
        await this.options.events.publishApprovalResolved(approval.id, 'cancel', 'Turn cancelled.', resolved.resolvedAt);
      }
      throw error;
    }

    await this.options.events.publishApprovalResolved(approval.id, answer.decision, answer.message);
    throwIfApprovalCancelled(answer.decision);
    await this.persistExecPolicyAmendmentDecision(answer, requirement.proposedExecPolicyAmendment);
    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    if (answer.decision === 'approve_persistently') {
      await this.options.persistentToolApprovalStore?.approve(persistentApprovalKeys);
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer.decision;
  }

  private async approvalRequirement(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy'], environment: ToolExecutionEnvironment): Promise<ToolApprovalRequirement> {
    const strictAutoReview = this.options.approvalStore?.strictAutoReviewEnabled(context.turnId) ?? false;
    const fileRequirement = assessFileMutationApproval(toolCall, parsedArguments, context, approvalPolicy);
    if (fileRequirement) return fileRequirement;
    const additionalPermissionRequirement = assessAdditionalSandboxPermissionsApproval(toolCall, parsedArguments, context, approvalPolicy, Boolean(this.options.approvalGate), environment);
    if (additionalPermissionRequirement) return additionalPermissionRequirement;
    const requestsSandboxBypass = requestedSandboxBypass(toolCall.name, parsedArguments);
    if (requestsSandboxBypass && approvalPolicy === 'full' && context.permissionProfile !== 'danger-full-access') {
      return {
        action: 'reject',
        reason: '无需确认模式仍受工作区沙箱限制；无沙箱执行需要切换到“完全访问”或启用可交互审批。',
      };
    }
    const runtimeProfile = await this.options.toolHost.toolRuntimeProfile?.(toolCall.name, context);
    if (runtimeProfile?.approvalMode === 'selfManaged' && !requestsSandboxBypass) return { action: 'skip' };
    // 权限配置仍用于定义实际生效的文件系统边界，但完整审批策略本身绝不能触发交互提示。
    if (approvalPolicy === 'full' && !strictAutoReview) return { action: 'skip' };
    if (!this.options.approvalGate) {
      return requestsSandboxBypass
        ? { action: 'reject', reason: 'Unsandboxed shell execution requires an interactive approval gate.' }
        : { action: 'skip' };
    }
    const execApprovalLookupKeys = execApprovalSessionLookupKeys(toolCall, parsedArguments, context);
    if (!strictAutoReview && this.options.approvalStore?.hasAny(execApprovalLookupKeys, context.turnId)) return { action: 'skip' };

    const hostRequirement = await this.options.toolHost.approvalForTool?.(toolCall.name, parsedArguments, context);
    if (hostRequirement) {
      return {
        action: 'ask',
        reason: hostRequirement.reason,
        argumentsPreview: hostRequirement.argumentsPreview ?? previewArguments(parsedArguments),
        approvalKeys: hostRequirement.approvalKeys ?? execApprovalApprovalKeys(toolCall, parsedArguments, context),
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

  private async persistExecPolicyAmendmentDecision(answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>, fallback?: RuntimeExecPolicyAmendment): Promise<void> {
    if (answer.decision !== 'approve_exec_policy_amendment') return;
    const amendment = answer.proposedExecPolicyAmendment?.length ? answer.proposedExecPolicyAmendment : fallback;
    if (amendment?.length) await this.options.policyAmendmentStore?.appendExecPolicyAmendment(amendment);
  }

  private async persistNetworkPolicyAmendmentDecision(
    answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>,
    networkApprovalContext?: RuntimeNetworkApprovalContext | null,
    commandWideNetworkApproval = false,
  ): Promise<void> {
    if (answer.decision !== 'approve_network_policy_amendment') return;
    const amendments = proposedNetworkPolicyAmendments(networkApprovalContext, commandWideNetworkApproval);
    const fallbackAction = commandWideNetworkApproval ? 'deny' : 'allow';
    const requested = answer.networkPolicyAmendment ?? amendments?.find((item) => item.action === fallbackAction);
    const amendment = amendments?.find((item) => item.host === requested?.host && item.action === requested?.action);
    if (amendment) await this.options.policyAmendmentStore?.appendNetworkPolicyAmendment(amendment, networkApprovalContext?.protocol);
  }

  private async persistentApprovalIsRemembered(keys: string[]): Promise<boolean> {
    return Boolean(keys.length && await this.options.persistentToolApprovalStore?.hasAll(keys));
  }
}

export { ToolApprovalStore } from './tool-approval-store.js';
