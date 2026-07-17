import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { AnswerRuntimeApprovalInput, RuntimeApprovalAvailableDecision, RuntimeApprovalDecision, RuntimeHookRun, RuntimePermissionGrantResponse, RuntimeApprovalRequest, RuntimeConfigState, RuntimeExecPolicyAmendment, RuntimeNetworkPolicyAmendment, RuntimeSandboxWorkspaceWrite, RuntimeToolCall } from '@setsuna-desktop/contracts';
import type { ApprovalGate } from '../ports/approval-gate.js';
import type { Clock } from '../ports/clock.js';
import type { PolicyAmendmentStore } from '../ports/policy-amendment-store.js';
import type { PersistentToolApprovalStore } from '../ports/persistent-tool-approval-store.js';
import { ToolExecutionError, type RuntimeToolExecutionContext, type ToolExecutionEnvironment, type ToolExecutionResult, type ToolHost, type ToolOutputDelta } from '../ports/tool-host.js';
import type { RuntimeToolHookRunner } from '../hooks/runtime-hooks.js';
import { assessFileMutationPolicy, FILE_MUTATION_TOOL_NAMES, protectedWorkspaceMetadataPathForPath } from '../security/file-system-policy.js';
import { networkApprovalContextFromTool, networkApprovalKeysForContext, type RuntimeNetworkApprovalContext } from '../security/network-approval-policy.js';

export { FILE_MUTATION_TOOL_NAMES };

export class ToolApprovalStore {
  private readonly approvedForSession = new Set<string>();
  private readonly approvedForTurn = new Map<string, Set<string>>();
  private readonly sessionSandboxGrants = new Map<string, RuntimeSandboxWorkspaceWrite>();
  private readonly turnSandboxGrants = new Map<string, Map<string, RuntimeSandboxWorkspaceWrite>>();
  private readonly strictAutoReviewTurns = new Set<string>();

  hasAll(keys: string[], turnId?: string): boolean {
    const turnKeys = turnId ? this.approvedForTurn.get(turnId) : undefined;
    return keys.length > 0 && keys.every((key) => this.approvedForSession.has(key) || Boolean(turnKeys?.has(key)));
  }

  hasAny(keys: string[], turnId?: string): boolean {
    const turnKeys = turnId ? this.approvedForTurn.get(turnId) : undefined;
    return keys.some((key) => this.approvedForSession.has(key) || Boolean(turnKeys?.has(key)));
  }

  approveForSession(keys: string[]): void {
    for (const key of keys) {
      if (key) this.approvedForSession.add(key);
    }
  }

  approveForTurn(turnId: string, keys: string[]): void {
    if (!turnId) return;
    let turnKeys = this.approvedForTurn.get(turnId);
    if (!turnKeys) {
      turnKeys = new Set<string>();
      this.approvedForTurn.set(turnId, turnKeys);
    }
    for (const key of keys) {
      if (key) turnKeys.add(key);
    }
  }

  enableStrictAutoReviewForTurn(turnId: string): void {
    if (turnId) this.strictAutoReviewTurns.add(turnId);
  }

  strictAutoReviewEnabled(turnId: string): boolean {
    return Boolean(turnId && this.strictAutoReviewTurns.has(turnId));
  }

  grantSandboxPermissions(scope: RequestPermissionGrantScope, turnId: string, environmentId: string, sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): void {
    if (!environmentId || isEmptySandboxWorkspaceWrite(sandboxWorkspaceWrite)) return;
    if (scope === 'session') {
      this.sessionSandboxGrants.set(environmentId, mergeSandboxWorkspaceWrite(this.sessionSandboxGrants.get(environmentId), sandboxWorkspaceWrite));
      return;
    }
    if (!turnId) return;
    let grants = this.turnSandboxGrants.get(turnId);
    if (!grants) {
      grants = new Map<string, RuntimeSandboxWorkspaceWrite>();
      this.turnSandboxGrants.set(turnId, grants);
    }
    grants.set(environmentId, mergeSandboxWorkspaceWrite(grants.get(environmentId), sandboxWorkspaceWrite));
  }

  sandboxWorkspaceWriteFor(turnId: string, environmentId: string): RuntimeSandboxWorkspaceWrite {
    return mergeSandboxWorkspaceWrite(
      this.sessionSandboxGrants.get(environmentId),
      this.turnSandboxGrants.get(turnId)?.get(environmentId),
    );
  }

  clearTurn(turnId: string): void {
    this.approvedForTurn.delete(turnId);
    this.turnSandboxGrants.delete(turnId);
    this.strictAutoReviewTurns.delete(turnId);
  }
}


type ToolApprovalRequirement =
  | { action: 'skip' }
  | {
      action: 'ask';
      reason: string;
      argumentsPreview: string;
      approvalKeys?: string[];
      persistentApprovalKeys?: string[];
      proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
      environmentId?: string;
      additionalPermissions?: RequestPermissionProfileOutput;
    }
  | { action: 'reject'; reason: string };

type EffectiveToolCall = {
  toolCall: RuntimeToolCall;
  parsedArguments: unknown;
  rejectionReason?: string;
};

type RequestPermissionGrantScope = 'turn' | 'session';

type NetworkRetryApprovalAnswer = AnswerRuntimeApprovalInput;

const REQUEST_PERMISSIONS_TOOL_NAME = 'request_permissions';

export type ToolOrchestratorEvents = {
  publishToolStarted(toolCall: RuntimeToolCall, parsedArguments: unknown, resultPreview?: string): Promise<void>;
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
      startedAtMs = this.options.clock.now().getTime();
      await this.options.events.publishToolStarted(runToolCall, runArguments, startResultPreview);

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
      const firstRunSandbox = requestedSandboxBypass(runToolCall.name, runArguments)
        ? { mode: 'bypass' as const, retryReason: 'Command requested escalated sandbox permissions.' }
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
      throwIfAborted(stepContext.signal);
      content = result.content;
      const postHookOutcome = await this.options.hookRunner?.runPostToolUse({
        approvalPolicy,
        context: stepContext,
        environment,
        events: this.hookEvents(),
        parsedArguments: runArguments,
        result,
        toolCall: runToolCall,
      });
      const modelVisibleHookFeedback = postHookOutcome?.feedbackMessage
        ?? (postHookOutcome?.shouldBlock ? 'PostToolUse hook blocked the tool result.' : undefined);
      if (modelVisibleHookFeedback) {
        content = modelVisibleHookFeedback;
      }
      const hookAdditionalContexts = [...preHookAdditionalContexts, ...(postHookOutcome?.additionalContexts ?? [])];
      if (hookAdditionalContexts.length) {
        content = appendHookAdditionalContexts(content, hookAdditionalContexts);
      }
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(runToolCall, runArguments, 'success', result.preview ?? content, {
        data: result.data,
        resultPreview: result.preview,
        startedAtMs,
      });
      return { content, processed, result, status: 'success' };
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
  }): Promise<ToolOrchestratorRunResult | null> {
    const networkApprovalContext = networkApprovalContextFromToolError(toolError) ?? networkApprovalContextFromTool(toolCall.name, parsedArguments);
    if (networkPolicyDeniedError(toolError)) {
      const content = `Tool ${toolCall.name} was blocked by persistent network policy: ${toolError.message}`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'error', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: true, status: 'error' };
    }
    const retryReason = networkApprovalContext
      ? `Network access to "${networkApprovalContext.target}" is blocked by policy. Approve retry with network access.`
      : `Network access is blocked for ${toolCall.name}: ${toolError.message}. Approve retry with network access.`;
    const approvalAnswer = await this.approveNetworkAccessRetry(toolCall, parsedArguments, context, approvalPolicy, retryReason, environment, networkApprovalContext);
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
        onToolOutputDelta: (delta) => {
          const publish = this.options.events.publishToolOutputDelta(toolCall, delta).catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const result = await this.options.toolHost.runTool(toolCall.name, parsedArguments, retryContext);
      throwIfAborted(context.signal);
      const content = result.content;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'success', result.preview ?? content, {
        data: result.data,
        resultPreview: result.preview,
        startedAtMs,
      });
      return { content, processed: true, result, status: 'success' };
    } catch (retryError) {
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
  }): Promise<ToolOrchestratorRunResult | null> {
    const retryReason = `Sandbox denied ${toolCall.name}: ${toolError.message}. Approve retry without the OS sandbox.`;
    const decision = await this.approveSandboxBypassRetry(toolCall, parsedArguments, context, approvalPolicy, retryReason, environment);
    if (decision === 'reject') {
      const content = `Tool ${toolCall.name} sandbox retry was rejected.`;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'rejected', content, {
        resultPreview,
        startedAtMs,
      });
      return { content, processed: false, status: 'rejected' };
    }

    try {
      throwIfAborted(context.signal);
      const retryContext: RuntimeToolExecutionContext = {
        ...context,
        sandboxWorkspaceWrite: this.sandboxWorkspaceWriteForRun(context, additionalSandboxPermissionsForTool(toolCall, parsedArguments, context, environment)?.sandboxWorkspaceWrite),
        sandbox: { mode: 'bypass', retryReason },
        toolCallId: toolCall.id,
        onToolOutputDelta: (delta) => {
          const publish = this.options.events.publishToolOutputDelta(toolCall, delta).catch(() => undefined);
          outputDeltaPublishes.push(publish);
        },
      };
      const result = await this.options.toolHost.runTool(toolCall.name, parsedArguments, retryContext);
      throwIfAborted(context.signal);
      const content = result.content;
      await Promise.all(outputDeltaPublishes);
      await this.options.events.publishToolCompleted(toolCall, parsedArguments, 'success', result.preview ?? content, {
        data: result.data,
        resultPreview: result.preview,
        startedAtMs,
      });
      return { content, processed: true, result, status: 'success' };
    } catch (retryError) {
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
      argumentsPreview: networkApprovalContext
        ? previewArguments({ command: ['network-access', networkApprovalContext.target], network_approval_context: networkApprovalContext })
        : previewArguments(parsedArguments),
      availableDecisions: networkApprovalAvailableDecisions(networkApprovalContext),
      ...(networkApprovalContext ? { networkApprovalContext } : {}),
      proposedNetworkPolicyAmendments: proposedNetworkPolicyAmendments(networkApprovalContext),
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
    await this.persistNetworkPolicyAmendmentDecision(answer, networkApprovalContext);
    if (decisionGrantsSessionReuse(answer.decision) && answer.networkPolicyAmendment?.action !== 'deny') {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer;
  }

  private async approveSandboxBypassRetry(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy'], reason: string, environment: ToolExecutionEnvironment): Promise<RuntimeApprovalDecision> {
    if (approvalPolicy === 'full') return 'approve';
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
    if (decisionGrantsSessionReuse(answer.decision)) {
      this.options.approvalStore?.approveForSession(approvalKeys);
    }
    return answer.decision;
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

  private async persistNetworkPolicyAmendmentDecision(answer: Awaited<ReturnType<ApprovalGate['waitForDecision']>>, networkApprovalContext?: RuntimeNetworkApprovalContext | null): Promise<void> {
    if (answer.decision !== 'approve_network_policy_amendment') return;
    const amendment = answer.networkPolicyAmendment ?? proposedNetworkPolicyAmendments(networkApprovalContext)?.find((item) => item.action === 'allow');
    if (amendment) await this.options.policyAmendmentStore?.appendNetworkPolicyAmendment(amendment, networkApprovalContext?.protocol);
  }

  private async persistentApprovalIsRemembered(keys: string[]): Promise<boolean> {
    return Boolean(keys.length && await this.options.persistentToolApprovalStore?.hasAll(keys));
  }
}

class ToolPolicyRejectedError extends Error {}

function toolApprovalAvailableDecisions(requirement: Extract<ToolApprovalRequirement, { action: 'ask' }>): RuntimeApprovalAvailableDecision[] {
  const decisions: RuntimeApprovalAvailableDecision[] = [{ type: 'approve' }];
  if (requirement.proposedExecPolicyAmendment?.length) {
    decisions.push({
      type: 'approve_exec_policy_amendment',
      proposedExecPolicyAmendment: requirement.proposedExecPolicyAmendment,
    });
  } else if (requirement.approvalKeys?.length) {
    decisions.push({ type: 'approve_for_session' });
    if (requirement.persistentApprovalKeys?.length) {
      decisions.push({ type: 'approve_persistently' });
    }
  }
  decisions.push({ type: 'reject' });
  return decisions;
}

function networkApprovalAvailableDecisions(networkApprovalContext?: RuntimeNetworkApprovalContext | null): RuntimeApprovalAvailableDecision[] {
  const decisions: RuntimeApprovalAvailableDecision[] = [
    { type: 'approve' },
    { type: 'approve_for_session' },
  ];
  for (const amendment of proposedNetworkPolicyAmendments(networkApprovalContext) ?? []) {
    decisions.push({ type: 'approve_network_policy_amendment', networkPolicyAmendment: amendment });
  }
  decisions.push({ type: 'reject' });
  return decisions;
}

function decisionGrantsSessionReuse(decision: RuntimeApprovalDecision): boolean {
  return decision === 'approve_for_session'
    || decision === 'approve_exec_policy_amendment'
    || decision === 'approve_network_policy_amendment';
}

function effectiveToolCallFor(toolCall: RuntimeToolCall, parsedArguments: unknown): EffectiveToolCall {
  const shellApplyPatch = shellApplyPatchInterception(toolCall.name, parsedArguments);
  if (!shellApplyPatch) return { toolCall, parsedArguments };
  const patchArguments = shellApplyPatch.patch
    ? {
        patch: shellApplyPatch.patch,
        ...(shellApplyPatch.workdir ? { workdir: shellApplyPatch.workdir } : {}),
        intercepted_from_shell_command: true,
      }
    : {};
  return {
    toolCall: {
      ...toolCall,
      name: 'apply_patch',
      arguments: JSON.stringify(patchArguments),
    },
    parsedArguments: patchArguments,
    rejectionReason: shellApplyPatch.rejectionReason,
  };
}

function applyHookUpdatedInput(toolName: string, currentArguments: unknown, updatedInput: unknown): unknown {
  const current = recordInput(currentArguments);
  const updated = recordInput(updatedInput);
  if (isShellCommandToolName(toolName)) {
    const command = stringArg(updated.command ?? updated.cmd);
    if (!command) return updatedInput;
    return {
      ...current,
      ...(toolName === 'exec_command' ? { cmd: command } : { command }),
      ...(current.command !== undefined && toolName === 'exec_command' ? { command } : {}),
      ...(current.cmd !== undefined && toolName !== 'exec_command' ? { cmd: command } : {}),
    };
  }
  if (toolName === 'apply_patch') {
    const patch = stringArg(updated.command ?? updated.patch);
    return patch ? { ...current, patch } : updatedInput;
  }
  return updatedInput;
}

function shellApplyPatchInterception(toolName: string, parsedArguments: unknown): { patch?: string; workdir?: string; rejectionReason?: string } | null {
  if (!isShellCommandToolName(toolName)) return null;
  const record = recordInput(parsedArguments);
  const command = stringArg(record.command ?? record.cmd);
  if (!usesShellApplyPatch(command)) return null;
  const invocation = extractApplyPatchFromShellCommand(command);
  if (!invocation) {
    return {
      rejectionReason: 'Shell apply_patch command could not be parsed. Use apply_patch directly, or use exactly apply_patch <<EOF / cd <path> && apply_patch <<EOF.',
    };
  }
  const shellWorkdir = stringArg(record.directory ?? record.workdir ?? record.cwd);
  return {
    patch: invocation.patch,
    workdir: combineShellApplyPatchWorkdirs(shellWorkdir, invocation.workdir),
  };
}

function isShellCommandToolName(toolName: string): boolean {
  return toolName === 'run_shell_command' || toolName === 'exec_command';
}

function requestedSandboxBypass(toolName: string, parsedArguments: unknown): boolean {
  if (!isShellCommandToolName(toolName)) return false;
  const record = recordInput(parsedArguments);
  return stringArg(record.sandbox_permissions ?? record.sandboxPermissions) === 'require_escalated';
}

function execApprovalApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] | undefined {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return undefined;
  const environmentId = environmentIdForContext(context);
  const prefix = validRequestedExecPrefixRule(parsedArguments);
  if (prefix.length) return [execApprovalPrefixKey(environmentId, prefix)];
  const command = shellCommandForApprovalKey(parsedArguments);
  return command ? [execApprovalExactKey(environmentId, command)] : undefined;
}

function execApprovalSessionLookupKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return [];
  const environmentId = environmentIdForContext(context);
  const command = shellCommandForApprovalKey(parsedArguments);
  const words = shellCommandWords(command);
  const keys = command ? [execApprovalExactKey(environmentId, command)] : [];
  for (let length = 1; length <= words.length; length += 1) {
    keys.push(execApprovalPrefixKey(environmentId, words.slice(0, length)));
  }
  return [...new Set(keys)];
}

function requestedExecPrefixRule(parsedArguments: unknown): string[] {
  const record = recordInput(parsedArguments);
  const raw = record.prefix_rule ?? record.prefixRule;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => stringArg(item)).filter(Boolean);
}

function validRequestedExecPrefixRule(parsedArguments: unknown): string[] {
  const prefix = requestedExecPrefixRule(parsedArguments);
  if (!prefix.length || isBannedExecPrefixSuggestion(prefix)) return [];
  const words = shellCommandWords(shellCommandForApprovalKey(parsedArguments));
  if (!wordsStartWith(words, prefix)) return [];
  return prefix;
}

function proposedExecPolicyAmendment(toolCall: RuntimeToolCall, parsedArguments: unknown): RuntimeExecPolicyAmendment | undefined {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return undefined;
  const prefix = validRequestedExecPrefixRule(parsedArguments);
  return prefix.length ? prefix : undefined;
}

const BANNED_EXEC_PREFIX_SUGGESTIONS = [
  ['python3'],
  ['python3', '-'],
  ['python3', '-c'],
  ['python'],
  ['python', '-'],
  ['python', '-c'],
  ['py'],
  ['py', '-3'],
  ['pythonw'],
  ['pyw'],
  ['pypy'],
  ['pypy3'],
  ['git'],
  ['bash'],
  ['bash', '-lc'],
  ['sh'],
  ['sh', '-c'],
  ['sh', '-lc'],
  ['zsh'],
  ['zsh', '-lc'],
  ['/bin/zsh'],
  ['/bin/zsh', '-lc'],
  ['/bin/bash'],
  ['/bin/bash', '-lc'],
  ['pwsh'],
  ['pwsh', '-Command'],
  ['pwsh', '-c'],
  ['powershell'],
  ['powershell', '-Command'],
  ['powershell', '-c'],
  ['powershell.exe'],
  ['powershell.exe', '-Command'],
  ['powershell.exe', '-c'],
  ['env'],
  ['sudo'],
  ['node'],
  ['node', '-e'],
  ['perl'],
  ['perl', '-e'],
  ['ruby'],
  ['ruby', '-e'],
  ['php'],
  ['php', '-r'],
  ['lua'],
  ['lua', '-e'],
  ['osascript'],
];

function isBannedExecPrefixSuggestion(prefix: string[]): boolean {
  return BANNED_EXEC_PREFIX_SUGGESTIONS.some((banned) =>
    banned.length === prefix.length && banned.every((word, index) => word === prefix[index]),
  );
}

function wordsStartWith(words: string[], prefix: string[]): boolean {
  return prefix.length <= words.length && prefix.every((word, index) => word === words[index]);
}

function execApprovalExactKey(environmentId: string, command: string): string {
  return ['exec-approval', environmentId, 'exact', command].join(':');
}

function execApprovalPrefixKey(environmentId: string, prefix: string[]): string {
  return ['exec-approval', environmentId, 'prefix', stableStringify(prefix)].join(':');
}

function usesShellApplyPatch(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:apply_patch|applypatch)\b/.test(command)
    || /\b(?:apply_patch|applypatch)\s*<</.test(command)
    || /<<[A-Z0-9_'-]*\s*\n?[^|&;]*(?:apply_patch|applypatch)\b/.test(command);
}

function extractApplyPatchFromShellCommand(command: string): { patch: string; workdir?: string } | null {
  const text = command.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const beginIndex = text.indexOf('*** Begin Patch');
  if (beginIndex < 0) return null;
  const endMatch = /^(\*\*\* End Patch)$/m.exec(text.slice(beginIndex));
  if (!endMatch) return null;
  const prefix = text.slice(0, beginIndex);
  const prefixMatch = /^\s*(?:(?:cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&\s*)?(?:apply_patch|applypatch)\s*<<[^\n]*\n)\s*$/.exec(prefix);
  if (!prefixMatch) return null;
  const patchEndIndex = beginIndex + endMatch.index + endMatch[1].length;
  const suffix = text.slice(patchEndIndex).trim();
  const heredocEnd = /^([A-Za-z0-9_'-]+)$/.test(suffix) ? '' : suffix;
  if (heredocEnd) return null;
  return {
    patch: text.slice(beginIndex, patchEndIndex),
    workdir: prefixMatch[1] ?? prefixMatch[2] ?? prefixMatch[3],
  };
}

function combineShellApplyPatchWorkdirs(shellWorkdir: string, commandWorkdir: string | undefined): string | undefined {
  const base = shellWorkdir && shellWorkdir !== '.' ? shellWorkdir : '';
  const child = commandWorkdir && commandWorkdir !== '.' ? commandWorkdir : '';
  if (!base) return child || undefined;
  if (!child) return base;
  return path.isAbsolute(child) ? child : path.join(base, child);
}

function assessFileMutationApproval(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy']): ToolApprovalRequirement | null {
  const assessment = assessFileMutationPolicy({
    args: parsedArguments,
    approvalPolicy,
    permissionProfile: context.permissionProfile,
    projectId: context.projectId,
    toolName: toolCall.name,
  });
  if (!assessment) return null;
  if (assessment.action === 'allow') return { action: 'skip' };
  if (assessment.action === 'reject') return { action: 'reject', reason: assessment.reason };
  return {
    action: 'ask',
    approvalKeys: assessment.approvalKeys,
    argumentsPreview: previewArguments(parsedArguments),
    reason: assessment.reason,
  };
}

type AdditionalSandboxPermissions = {
  approvalKeys: string[];
  reason: string;
  rejectionReason?: string;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
};

type RequestPermissionProfileOutput = {
  network?: { enabled?: boolean };
  file_system?: {
    write?: string[];
    read?: string[];
    glob_scan_max_depth?: number;
    entries?: Array<{
      path: { type: 'path'; path: string } | { type: 'glob_pattern'; pattern: string };
      access: 'write' | 'read' | 'deny';
    }>;
  };
};

type RequestPermissionsGrant = {
  approvalKeys: string[];
  cwd: string;
  environmentId: string;
  grantedPermissions: RequestPermissionProfileOutput;
  reason: string;
  rejectionReason?: string;
  requestReason?: string;
  requestedPermissions: unknown;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
};

function requestPermissionsGrantForTool(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): RequestPermissionsGrant {
  const record = recordInput(parsedArguments);
  const requestedPermissions = recordInput(record.permissions);
  const requestReason = stringArg(record.reason);
  const environmentId = environment.id || environmentIdForContext(context);
  const requestedEnvironmentId = stringArg(record.environment_id ?? record.environmentId);
  if (requestedEnvironmentId && requestedEnvironmentId !== environmentId) {
    return {
      approvalKeys: [],
      cwd: environment.cwd,
      environmentId,
      grantedPermissions: emptyRequestPermissionProfile(),
      reason: requestReason || `Additional permissions requested for ${toolCall.name}.`,
      rejectionReason: `request_permissions supports only the active environment (${environmentId}); got ${requestedEnvironmentId}.`,
      requestReason,
      requestedPermissions,
      sandboxWorkspaceWrite: {},
    };
  }

  const network = recordInput(requestedPermissions.network);
  const fileSystem = recordInput(requestedPermissions.file_system ?? requestedPermissions.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = [...new Set(writableRoots)];
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  const grantedPermissions = requestPermissionProfileFromSandbox(sandboxWorkspaceWrite);
  const reasonParts = [
    requestReason,
    sandboxWorkspaceWrite.networkAccess ? 'network access' : '',
    sandboxWorkspaceWrite.readableRoots?.length ? `readable roots: ${sandboxWorkspaceWrite.readableRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.writableRoots?.length ? `writable roots: ${sandboxWorkspaceWrite.writableRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.deniedRoots?.length ? `denied roots: ${sandboxWorkspaceWrite.deniedRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.deniedGlobPatterns?.length ? `denied globs: ${sandboxWorkspaceWrite.deniedGlobPatterns.join(', ')}` : '',
    protectedWritableRoot ? `protected metadata write root rejected: ${protectedWritableRoot}` : '',
  ].filter(Boolean);
  return {
    approvalKeys: requestPermissionsApprovalKeys(environmentId, grantedPermissions),
    cwd: environment.cwd,
    environmentId,
    grantedPermissions,
    reason: `Additional permissions requested: ${reasonParts.join('; ') || 'none'}.`,
    rejectionReason: protectedWritableRoot
      ? `request_permissions cannot grant write access to protected workspace metadata: ${protectedWritableRoot}.`
      : undefined,
    requestReason,
    requestedPermissions,
    sandboxWorkspaceWrite,
  };
}

function requestPermissionEntryPaths(value: unknown, cwd: string): { read: string[]; write: string[]; deny: string[]; denyGlobPatterns: string[] } {
  const read: string[] = [];
  const write: string[] = [];
  const deny: string[] = [];
  const denyGlobPatterns: string[] = [];
  if (!Array.isArray(value)) return { read, write, deny, denyGlobPatterns };
  for (const item of value) {
    const entry = recordInput(item);
    const access = stringArg(entry.access);
    const entryPath = requestPermissionPath(entry.path, cwd);
    if (!entryPath) continue;
    if (entryPath.type === 'glob_pattern') {
      if (access === 'deny' || access === 'none') denyGlobPatterns.push(entryPath.pattern);
      continue;
    }
    const filePath = entryPath.path;
    if (access === 'write') write.push(filePath);
    if (access === 'read') read.push(filePath);
    if (access === 'deny' || access === 'none') deny.push(filePath);
  }
  return { read, write, deny, denyGlobPatterns };
}

function requestPermissionPath(value: unknown, cwd: string): { type: 'path'; path: string } | { type: 'glob_pattern'; pattern: string } | null {
  if (typeof value === 'string') return { type: 'path', path: normalizeRequestPermissionPath(value, cwd) };
  const record = recordInput(value);
  const type = stringArg(record.type);
  if (!type || type === 'path') {
    const pathValue = record.path;
    return typeof pathValue === 'string' ? { type: 'path', path: normalizeRequestPermissionPath(pathValue, cwd) } : null;
  }
  if (type === 'glob_pattern') {
    const pattern = stringArg(record.pattern);
    return pattern ? { type: 'glob_pattern', pattern: normalizeRequestPermissionGlobPattern(pattern, cwd) } : null;
  }
  if (type === 'special') {
    const specialPath = requestPermissionSpecialPath(record.value, cwd);
    return specialPath ? { type: 'path', path: specialPath } : null;
  }
  return null;
}

function normalizeRequestPermissionPaths(paths: string[], cwd: string): string[] {
  return [...new Set(paths.map((item) => normalizeRequestPermissionPath(item, cwd)).filter(Boolean))];
}

function normalizeRequestPermissionGlobPatterns(patterns: string[], cwd: string): string[] {
  return [...new Set(patterns.map((item) => normalizeRequestPermissionGlobPattern(item, cwd)).filter(Boolean))];
}

function normalizeRequestPermissionPath(value: unknown, cwd: string): string {
  const text = stringArg(value).replace(/\\/g, path.sep);
  if (!text) return '';
  if (text.startsWith('~/')) return path.resolve(homedir(), text.slice(2));
  return path.resolve(path.isAbsolute(text) ? text : path.join(cwd || process.cwd(), text));
}

const PROJECT_ROOTS_GLOB_PATTERN_PREFIX = 'codex-project-roots://';

function normalizeRequestPermissionGlobPattern(value: unknown, cwd: string): string {
  const text = stringArg(value).replace(/\\/g, path.sep);
  if (!text) return '';
  if (text.startsWith(PROJECT_ROOTS_GLOB_PATTERN_PREFIX)) {
    return path.resolve(cwd || process.cwd(), text.slice(PROJECT_ROOTS_GLOB_PATTERN_PREFIX.length));
  }
  if (text.startsWith('~/')) return path.resolve(homedir(), text.slice(2));
  return path.resolve(path.isAbsolute(text) ? text : path.join(cwd || process.cwd(), text));
}

function requestPermissionSpecialPath(value: unknown, cwd: string): string {
  const record = recordInput(value);
  const kind = stringArg(record.kind ?? value);
  if (kind === 'root') return path.parse(path.resolve(cwd || process.cwd())).root;
  if (kind === 'project_roots' || kind === 'current_working_directory') {
    const subpath = stringArg(record.subpath);
    return normalizeRequestPermissionPath(subpath || '.', cwd);
  }
  if (kind === 'tmpdir') return path.resolve(tmpdir());
  if (kind === 'slash_tmp' && process.platform !== 'win32') return '/tmp';
  return '';
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function requestPermissionProfileFromSandbox(sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): RequestPermissionProfileOutput {
  const permissions: RequestPermissionProfileOutput = {};
  if (sandboxWorkspaceWrite.networkAccess === true) permissions.network = { enabled: true };
  if (sandboxWorkspaceWrite.readableRoots?.length || sandboxWorkspaceWrite.writableRoots?.length || sandboxWorkspaceWrite.deniedRoots?.length || sandboxWorkspaceWrite.deniedGlobPatterns?.length) {
    const read = [...new Set(sandboxWorkspaceWrite.readableRoots ?? [])];
    const write = [...new Set(sandboxWorkspaceWrite.writableRoots)];
    const deny = [...new Set(sandboxWorkspaceWrite.deniedRoots ?? [])];
    const denyGlobPatterns = [...new Set(sandboxWorkspaceWrite.deniedGlobPatterns ?? [])];
    permissions.file_system = {
      ...(read.length ? { read } : {}),
      ...(write.length ? { write } : {}),
      ...(sandboxWorkspaceWrite.globScanMaxDepth ? { glob_scan_max_depth: sandboxWorkspaceWrite.globScanMaxDepth } : {}),
      entries: [
        ...read.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'read' as const,
        })),
        ...write.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'write' as const,
        })),
        ...deny.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'deny' as const,
        })),
        ...denyGlobPatterns.map((pattern) => ({
          path: { type: 'glob_pattern' as const, pattern },
          access: 'deny' as const,
        })),
      ],
    };
  }
  return permissions;
}

function emptyRequestPermissionProfile(): RequestPermissionProfileOutput {
  return {};
}

type RequestPermissionResponse = {
  permissions: RequestPermissionProfileOutput;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
  scope: RequestPermissionGrantScope;
  strictAutoReview: boolean;
};

function requestPermissionResponseForDecision(
  decision: RuntimeApprovalDecision,
  permissionGrant: RuntimePermissionGrantResponse | undefined,
  request: RequestPermissionsGrant,
  context: RuntimeToolExecutionContext,
  environment: ToolExecutionEnvironment,
): RequestPermissionResponse {
  if (decision === 'reject') return emptyRequestPermissionResponse();
  const requestedSandbox = request.sandboxWorkspaceWrite;
  const decisionStrictAutoReview = decision === 'approve_for_turn_with_strict_auto_review';
  const requestedScope: RequestPermissionGrantScope = decision === 'approve_for_session' ? 'session' : 'turn';
  const grantScope = permissionGrant?.scope === 'session' ? 'session' : permissionGrant?.scope === 'turn' ? 'turn' : requestedScope;
  const strictAutoReview = Boolean(permissionGrant?.strictAutoReview ?? permissionGrant?.strict_auto_review ?? decisionStrictAutoReview);
  if (strictAutoReview && grantScope === 'session') return emptyRequestPermissionResponse();

  const grantedSandbox = permissionGrant
    ? sandboxWorkspaceWriteFromPermissionProfile(permissionGrant.permissions, context, environment)
    : requestedSandbox;
  const sandboxWorkspaceWrite = intersectSandboxWorkspaceWrite(requestedSandbox, grantedSandbox);
  return {
    permissions: requestPermissionProfileFromSandbox(sandboxWorkspaceWrite),
    sandboxWorkspaceWrite,
    scope: grantScope,
    strictAutoReview,
  };
}

function emptyRequestPermissionResponse(): RequestPermissionResponse {
  return {
    permissions: emptyRequestPermissionProfile(),
    sandboxWorkspaceWrite: {},
    scope: 'turn',
    strictAutoReview: false,
  };
}

function sandboxWorkspaceWriteFromPermissionProfile(value: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): RuntimeSandboxWorkspaceWrite {
  const record = recordInput(value);
  const network = recordInput(record.network);
  const fileSystem = recordInput(record.file_system ?? record.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = [...new Set(writableRoots)];
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  return sandboxWorkspaceWrite;
}

function intersectSandboxWorkspaceWrite(requested: RuntimeSandboxWorkspaceWrite, granted: RuntimeSandboxWorkspaceWrite): RuntimeSandboxWorkspaceWrite {
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (requested.networkAccess === true && granted.networkAccess === true) sandboxWorkspaceWrite.networkAccess = true;
  const readableRoots = intersectRoots(requested.readableRoots, granted.readableRoots);
  const writableRoots = intersectRoots(requested.writableRoots, granted.writableRoots);
  if (readableRoots.length) sandboxWorkspaceWrite.readableRoots = readableRoots;
  if (writableRoots.length) sandboxWorkspaceWrite.writableRoots = writableRoots;
  if (requested.deniedRoots?.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(requested.deniedRoots)];
  if (requested.deniedGlobPatterns?.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(requested.deniedGlobPatterns)];
  const grantedDepth = granted.globScanMaxDepth;
  const requestedDepth = requested.globScanMaxDepth;
  if (requestedDepth && grantedDepth) sandboxWorkspaceWrite.globScanMaxDepth = Math.min(requestedDepth, grantedDepth);
  else if (requestedDepth) sandboxWorkspaceWrite.globScanMaxDepth = requestedDepth;
  return sandboxWorkspaceWrite;
}

function intersectRoots(requestedRoots: string[] | undefined, grantedRoots: string[] | undefined): string[] {
  const roots = new Set<string>();
  for (const requestedRoot of requestedRoots ?? []) {
    for (const grantedRoot of grantedRoots ?? []) {
      if (pathWithinOrEqual(grantedRoot, requestedRoot)) roots.add(grantedRoot);
      else if (pathWithinOrEqual(requestedRoot, grantedRoot)) roots.add(requestedRoot);
    }
  }
  return [...roots];
}

function pathWithinOrEqual(candidate: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assessAdditionalSandboxPermissionsApproval(
  toolCall: RuntimeToolCall,
  parsedArguments: unknown,
  context: RuntimeToolExecutionContext,
  approvalPolicy: RuntimeConfigState['approvalPolicy'],
  hasApprovalGate: boolean,
  environment: ToolExecutionEnvironment,
): ToolApprovalRequirement | null {
  const permissions = additionalSandboxPermissionsForTool(toolCall, parsedArguments, context, environment);
  if (!permissions) return null;
  if (permissions.rejectionReason) {
    return {
      action: 'reject',
      reason: permissions.rejectionReason,
    };
  }
  const hasFileSystemRoots = Boolean(
    permissions.sandboxWorkspaceWrite.readableRoots?.length
      || permissions.sandboxWorkspaceWrite.writableRoots?.length
      || permissions.sandboxWorkspaceWrite.deniedRoots?.length
      || permissions.sandboxWorkspaceWrite.deniedGlobPatterns?.length,
  );
  if (!permissions.sandboxWorkspaceWrite.networkAccess && !hasFileSystemRoots) {
    return {
      action: 'reject',
      reason: 'with_additional_permissions requires additional_permissions.network.enabled or additional_permissions.file_system read/write roots.',
    };
  }
  if (approvalPolicy === 'full') return { action: 'skip' };
  if (!hasApprovalGate) {
    return {
      action: 'reject',
      reason: 'with_additional_permissions requires an approval gate before granting extra sandbox permissions.',
    };
  }
  return {
    action: 'ask',
    approvalKeys: permissions.approvalKeys,
    argumentsPreview: previewArguments(parsedArguments),
    additionalPermissions: requestPermissionProfileFromSandbox(permissions.sandboxWorkspaceWrite),
    environmentId: environment.id || environmentIdForContext(context),
    reason: permissions.reason,
  };
}

function additionalSandboxPermissionsForTool(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): AdditionalSandboxPermissions | null {
  if (!isShellCommandToolName(toolCall.name)) return null;
  const record = recordInput(parsedArguments);
  if (stringArg(record.sandbox_permissions ?? record.sandboxPermissions) !== 'with_additional_permissions') return null;
  const additional = recordInput(record.additional_permissions ?? record.additionalPermissions);
  const network = recordInput(additional.network);
  const fileSystem = recordInput(additional.file_system ?? additional.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = writableRoots;
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  const reasonParts = [
    sandboxWorkspaceWrite.networkAccess ? 'network access' : '',
    readGrants.length ? `readable roots: ${readGrants.join(', ')}` : '',
    writableRoots.length ? `writable roots: ${writableRoots.join(', ')}` : '',
    denyGrants.length ? `denied roots: ${denyGrants.join(', ')}` : '',
    deniedGlobPatterns.length ? `denied globs: ${deniedGlobPatterns.join(', ')}` : '',
    protectedWritableRoot ? `protected metadata write root rejected: ${protectedWritableRoot}` : '',
  ].filter(Boolean);
  if (protectedWritableRoot) {
    return {
      approvalKeys: additionalSandboxApprovalKeys(toolCall, parsedArguments, context, sandboxWorkspaceWrite),
      reason: `Additional sandbox permissions requested for ${toolCall.name}: protected metadata write root rejected: ${protectedWritableRoot}.`,
      rejectionReason: `with_additional_permissions cannot grant write access to protected workspace metadata: ${protectedWritableRoot}.`,
      sandboxWorkspaceWrite,
    };
  }
  // 模型偶尔会只发送 with_additional_permissions 而漏掉具体授权内容。
  // 空授权不扩大沙箱边界，按 use_default 的安全语义继续执行即可。
  if (isEmptySandboxWorkspaceWrite(sandboxWorkspaceWrite)) return null;
  return {
    approvalKeys: additionalSandboxApprovalKeys(toolCall, parsedArguments, context, sandboxWorkspaceWrite),
    reason: `Additional sandbox permissions requested for ${toolCall.name}: ${reasonParts.join('; ') || 'none'}.`,
    sandboxWorkspaceWrite,
  };
}

function additionalSandboxApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): string[] {
  const environmentId = context.projectId ?? context.threadId;
  return [
    ['additional-permissions', environmentId, toolCall.name, shellCommandForApprovalKey(parsedArguments), stableStringify(sandboxWorkspaceWrite)].join(':'),
  ];
}

function requestPermissionsApprovalKeys(environmentId: string, grantedPermissions: RequestPermissionProfileOutput): string[] {
  return [
    ['request-permissions', environmentId, stableStringify(grantedPermissions)].join(':'),
  ];
}

function environmentIdForContext(context: RuntimeToolExecutionContext): string {
  return context.environment.id || context.projectId || context.threadId;
}

function shellCommandForApprovalKey(parsedArguments: unknown): string {
  const record = recordInput(parsedArguments);
  return stringArg(record.command ?? record.cmd);
}

function shellCommandWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of String(command || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    if (';&|<>'.includes(char)) {
      if (current) words.push(current);
      break;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function mergeSandboxWorkspaceWrite(base: RuntimeSandboxWorkspaceWrite | undefined, extra: RuntimeSandboxWorkspaceWrite | undefined): RuntimeSandboxWorkspaceWrite {
  const merged: RuntimeSandboxWorkspaceWrite = { ...(base ?? {}) };
  if (!extra) return merged;
  if (extra.networkAccess === true) merged.networkAccess = true;
  if (extra.excludeTmpdirEnvVar === true) merged.excludeTmpdirEnvVar = true;
  if (extra.excludeSlashTmp === true) merged.excludeSlashTmp = true;
  if (extra.globScanMaxDepth) merged.globScanMaxDepth = extra.globScanMaxDepth;
  const readableRoots = [...(merged.readableRoots ?? []), ...(extra.readableRoots ?? [])].filter(Boolean);
  if (readableRoots.length) merged.readableRoots = [...new Set(readableRoots)];
  const writableRoots = [...(merged.writableRoots ?? []), ...(extra.writableRoots ?? [])].filter(Boolean);
  if (writableRoots.length) merged.writableRoots = [...new Set(writableRoots)];
  const deniedRoots = [...(merged.deniedRoots ?? []), ...(extra.deniedRoots ?? [])].filter(Boolean);
  if (deniedRoots.length) merged.deniedRoots = [...new Set(deniedRoots)];
  const deniedGlobPatterns = [...(merged.deniedGlobPatterns ?? []), ...(extra.deniedGlobPatterns ?? [])].filter(Boolean);
  if (deniedGlobPatterns.length) merged.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  return merged;
}

function isEmptySandboxWorkspaceWrite(value: RuntimeSandboxWorkspaceWrite | undefined): boolean {
  return !value?.networkAccess
    && !value?.excludeSlashTmp
    && !value?.excludeTmpdirEnvVar
    && !value?.readableRoots?.length
    && !value?.writableRoots?.length
    && !value?.deniedRoots?.length
    && !value?.deniedGlobPatterns?.length;
}

function networkRetryApprovalKeys(
  toolCall: RuntimeToolCall,
  parsedArguments: unknown,
  context: RuntimeToolExecutionContext,
  networkApprovalContext: RuntimeNetworkApprovalContext | null = networkApprovalContextFromTool(toolCall.name, parsedArguments),
): string[] {
  const environmentId = context.projectId ?? context.threadId;
  if (networkApprovalContext) {
    return networkApprovalKeysForContext(networkApprovalContext, environmentId);
  }
  return [
    ['network', environmentId, toolCall.name, previewArguments(parsedArguments)].join(':'),
  ];
}

function proposedNetworkPolicyAmendments(networkApprovalContext?: RuntimeNetworkApprovalContext | null): RuntimeNetworkPolicyAmendment[] | undefined {
  if (!networkApprovalContext?.host) return undefined;
  const host = networkApprovalContext.host.toLowerCase();
  return [
    { host, action: 'allow' },
    { host, action: 'deny' },
  ];
}

function networkPolicyDeniedError(error: ToolExecutionError): boolean {
  const data = recordInput(error.data);
  return data.network_policy_decision === 'deny';
}

function sandboxRetryApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] {
  const environmentId = context.projectId ?? context.threadId;
  return [
    ['sandbox-bypass', environmentId, toolCall.name, previewArguments(parsedArguments)].join(':'),
  ];
}

function networkApprovalContextFromToolError(error: ToolExecutionError): RuntimeNetworkApprovalContext | null {
  const data = error.data && typeof error.data === 'object' && !Array.isArray(error.data)
    ? error.data as Record<string, unknown>
    : {};
  const context = data.network_approval_context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const record = context as Record<string, unknown>;
  const host = typeof record.host === 'string' ? record.host.trim() : '';
  const protocol = typeof record.protocol === 'string' ? record.protocol.trim() as RuntimeNetworkApprovalContext['protocol'] : 'unknown';
  const port = typeof record.port === 'number' ? record.port : Number(record.port);
  const target = typeof record.target === 'string' ? record.target.trim() : '';
  if (!host || !target || !Number.isFinite(port)) return null;
  return {
    host,
    protocol,
    port,
    target,
  };
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringArg(item)).filter(Boolean)
    : [];
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function previewArguments(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 1200);
}

function appendHookAdditionalContexts(content: string, contexts: string[]): string {
  const visibleContexts = contexts.map((item) => item.trim()).filter(Boolean);
  if (!visibleContexts.length) return content;
  return [
    content,
    '',
    '<hook_additional_context>',
    ...visibleContexts,
    '</hook_additional_context>',
  ].join('\n');
}

function toolRunWithCancellationProfile<T>(promise: Promise<T>, signal: AbortSignal, waitsForRuntimeCancellation: boolean): Promise<T> {
  if (waitsForRuntimeCancellation) return promise;
  // 某些 runtime 会自行管理后台进程生命周期。轮次取消后，不能让一直未完成的工具
  // Promise 继续维持代理轮次活动。
  void promise.catch(() => undefined);
  return abortable(promise, signal);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (!signal.aborted) return;
  throw abortReason(signal);
}

function throwIfApprovalCancelled(decision: RuntimeApprovalDecision): void {
  if (decision !== 'cancel') return;
  const error = new Error('Turn cancelled by approval decision.');
  error.name = 'AbortError';
  throw error;
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const reason = typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.';
  const error = new Error(reason);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
