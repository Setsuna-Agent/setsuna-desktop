import type {
  RuntimeApprovalDecision,
  RuntimeApprovalReviewer,
  RuntimeConfigState,
  RuntimeHookRun,
  RuntimePermissionGrantResponse,
  RuntimePluginReference,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeToolHookEvents,
  RuntimeToolHookRunner,
} from '../../hooks/runtime-hooks.js';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { ApprovalReviewer } from '../../ports/approval-reviewer.js';
import type { Clock } from '../../ports/clock.js';
import type { ExtensionRuntime } from '../../ports/extension-runtime.js';
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
import { isAbortError, throwIfAborted } from '../core/runtime-turn-errors.js';
import {
  ToolApprovalCoordinator,
} from './tool-approval-coordinator.js';
import {
  requestToolApproval,
  type ToolApprovalLifecycleEvents,
} from './tool-approval-lifecycle.js';
import { ToolApprovalStore } from './tool-approval-store.js';
import {
  additionalSandboxPermissionsForTool,
  appendHookAdditionalContexts,
  applyHookUpdatedInput,
  effectiveToolCallFor,
  emptyRequestPermissionProfile,
  environmentIdForContext,
  isEmptySandboxWorkspaceWrite,
  mergeSandboxWorkspaceWrite,
  networkRetryApprovalKeys,
  previewArguments,
  REQUEST_PERMISSIONS_TOOL_NAME,
  requestedSandboxBypass,
  requestPermissionResponseForDecision,
  requestPermissionsApprovalKeys,
  requestPermissionsGrantForTool,
  requiresUpfrontSandboxBypass,
  ToolPolicyRejectedError,
  toolRunWithCancellationProfile
} from './tool-orchestrator-policy.js';
import {
  ToolRetryStrategy,
  type ToolRetryOutcome,
  type ToolRetryStage,
} from './tool-retry-strategy.js';

export { FILE_MUTATION_TOOL_NAMES };

export type ToolOrchestratorEvents =
  & RuntimeToolHookEvents
  & ToolApprovalLifecycleEvents
  & {
  publishToolStarted(toolCall: RuntimeToolCall, parsedArguments: unknown, resultPreview?: string, plugin?: RuntimePluginReference): Promise<void>;
  publishToolCompleted(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    status: 'success' | 'error' | 'rejected',
    content: string,
    metadata?: { data?: unknown; resultPreview?: string; startedAtMs?: number },
  ): Promise<void>;
  publishToolOutputDelta(toolCall: RuntimeToolCall, delta: ToolOutputDelta): Promise<void>;
  };

export type ToolOrchestratorOptions = {
  toolHost: ToolHost;
  approvalGate?: ApprovalGate;
  approvalReviewer?: ApprovalReviewer;
  approvalReviewerMode?: RuntimeApprovalReviewer;
  approvalStore?: ToolApprovalStore;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  hookRunner?: RuntimeToolHookRunner | null;
  extensions?: Pick<ExtensionRuntime, 'dispatch'>;
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

type ToolRunCompletionInput = {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: RuntimeToolExecutionContext;
  environment: ToolExecutionEnvironment;
  outputDeltaPublishes: Promise<void>[];
  parsedArguments: unknown;
  preHookAdditionalContexts: string[];
  runOptions: ToolOrchestratorRunOptions;
  startedAtMs?: number;
  toolCall: RuntimeToolCall;
};

/**
 * 集中处理工具执行的 runtime 侧流程：预览、审批、执行、输出流和完成事件。
 * 保持现有编排边界，同时确保 Setsuna 当前事件协议稳定。
 */
export class ToolOrchestrator {
  private readonly approvals: ToolApprovalCoordinator;
  private readonly retries: ToolRetryStrategy;

  constructor(private readonly options: ToolOrchestratorOptions) {
    this.approvals = new ToolApprovalCoordinator(options);
    this.retries = new ToolRetryStrategy({
      approvals: this.approvals,
      toolHost: options.toolHost,
      events: options.events,
      sandboxWorkspaceWriteForRun: (context, extra) =>
        this.sandboxWorkspaceWriteForRun(context, extra),
    });
  }

  async canRunWithoutApproval(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy']): Promise<boolean> {
    return this.approvals.canRunWithoutApproval(
      toolCall,
      parsedArguments,
      context,
      approvalPolicy,
    );
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
      const preExtensionOutcome = effective.rejectionReason
        ? null
        : await this.options.extensions?.dispatch('tool.before', {
            threadId: stepContext.threadId,
            turnId: stepContext.turnId,
            projectId: stepContext.projectId,
            toolCallId: runToolCall.id,
            cwd: environment.cwd,
            ...(stepContext.features ? { features: stepContext.features } : {}),
            signal: stepContext.signal,
            payload: {
              tool: { id: runToolCall.id, name: runToolCall.name },
              input: runArguments,
              ...(runOptions.plugin ? { plugin: runOptions.plugin } : {}),
            },
          });
      if (preExtensionOutcome?.block) {
        throw new ToolPolicyRejectedError(preExtensionOutcome.reason || 'Extension blocked the tool call.');
      }
      if (preExtensionOutcome?.input !== undefined) {
        runArguments = applyHookUpdatedInput(runToolCall.name, runArguments, preExtensionOutcome.input);
        runToolCall = { ...runToolCall, arguments: JSON.stringify(runArguments) };
      }
      preHookAdditionalContexts.push(
        ...(preExtensionOutcome?.context ?? []),
        ...(preExtensionOutcome?.feedback ? [preExtensionOutcome.feedback] : []),
      );
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

      const runtimeProfile = runOptions.checkApproval === false
        ? null
        : (await this.options.toolHost.toolRuntimeProfile?.(runToolCall.name, stepContext) ?? null);
      const upfrontSandboxBypass = runOptions.checkApproval !== false && requiresUpfrontSandboxBypass(
        runtimeProfile,
        runToolCall,
        runArguments,
        stepContext,
        approvalPolicy,
      );
      const approval = runOptions.checkApproval === false
        ? 'approve'
        : await this.approvals.approveToolCall(
            runToolCall,
            runArguments,
            stepContext,
            approvalPolicy,
            environment,
            runtimeProfile,
          );
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
      const firstRunSandbox = fullAccess || requestedSandboxBypass(runToolCall.name, runArguments) || upfrontSandboxBypass
        ? {
            mode: 'bypass' as const,
            retryReason: fullAccess
              ? 'Full access mode disables the OS sandbox.'
              : upfrontSandboxBypass
                ? 'The OS sandbox is unavailable on this platform; unsandboxed execution was approved before the first attempt.'
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
        const retry = await this.retries.retryAfterSandboxDenied({
          approvalPolicy,
          context: stepContext,
          environment,
          expectedPreviewIntegrityToken,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          toolCall: runToolCall,
          toolError: error,
          waitsForRuntimeCancellation: runOptions.waitsForRuntimeCancellation !== false,
        });
        return this.completeRetryOutcome({
          approvalPolicy,
          context: stepContext,
          environment,
          outcome: retry,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          preHookAdditionalContexts,
          resultPreview: startResultPreview,
          runOptions,
          startedAtMs,
          toolCall: runToolCall,
        });
      }
      if (error instanceof ToolExecutionError && error.failureKind === 'network_denied') {
        const retry = await this.retries.retryAfterNetworkDenied({
          approvalPolicy,
          context: stepContext,
          environment,
          expectedPreviewIntegrityToken,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          toolCall: runToolCall,
          toolError: error,
          waitsForRuntimeCancellation: runOptions.waitsForRuntimeCancellation !== false,
        });
        return this.completeRetryOutcome({
          approvalPolicy,
          context: stepContext,
          environment,
          outcome: retry,
          outputDeltaPublishes,
          parsedArguments: runArguments,
          preHookAdditionalContexts,
          resultPreview: startResultPreview,
          runOptions,
          startedAtMs,
          toolCall: runToolCall,
        });
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
    let automaticReviewMessage: string | undefined;
    if (isEmptySandboxWorkspaceWrite(request.sandboxWorkspaceWrite)) {
      decision = 'reject';
    } else if (approvalPolicy === 'full') {
      decision = 'approve';
    } else if (!this.options.approvalGate) {
      decision = 'reject';
    } else {
      const answer = await requestToolApproval({
        approvalGate: this.options.approvalGate,
        automaticReview: { arguments: parsedArguments },
        automaticReviewer: this.options.approvalReviewer,
        events: this.options.events,
        request: {
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
        },
        reviewer: this.options.approvalReviewerMode ?? 'user',
        signal: context.signal,
      });
      decision = answer.decision;
      permissionGrant = answer.permissionGrant;
      if (answer.resolution?.source === 'automatic' && answer.decision === 'reject') {
        automaticReviewMessage = answer.message;
      }
    }

    const permissionResponse = requestPermissionResponseForDecision(decision, permissionGrant, request, context, environment);
    const response = {
      permissions: permissionResponse.permissions,
      scope: permissionResponse.scope,
      strict_auto_review: permissionResponse.strictAutoReview,
      ...(automaticReviewMessage ? { review_message: automaticReviewMessage } : {}),
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
  }: ToolRunCompletionInput & {
    result: ToolExecutionResult;
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
    const postExtensionOutcome = await this.options.extensions?.dispatch('tool.after', {
      threadId: context.threadId,
      turnId: context.turnId,
      projectId: context.projectId,
      toolCallId: toolCall.id,
      cwd: environment.cwd,
      ...(context.features ? { features: context.features } : {}),
      signal: context.signal,
      payload: {
        tool: { id: toolCall.id, name: toolCall.name },
        input: parsedArguments,
        result: {
          content: result.content,
          ...(result.preview ? { preview: result.preview } : {}),
          ...(result.data !== undefined ? { data: result.data } : {}),
        },
        ...(runOptions.plugin ? { plugin: runOptions.plugin } : {}),
      },
    });
    const extensionFeedback = postExtensionOutcome?.feedback
      ?? (postExtensionOutcome?.block ? postExtensionOutcome.reason || 'Extension blocked the tool result.' : undefined);
    if (extensionFeedback) content = extensionFeedback;
    const hookAdditionalContexts = [
      ...preHookAdditionalContexts,
      ...(postHookOutcome?.additionalContexts ?? []),
      ...(postExtensionOutcome?.context ?? []),
    ];
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

  private async completeRetryOutcome({
    outcome,
    resultPreview,
    ...completion
  }: ToolRunCompletionInput & {
    outcome: ToolRetryOutcome;
    resultPreview?: string;
  }): Promise<ToolOrchestratorRunResult> {
    if (outcome.kind === 'success') {
      try {
        return await this.completeSuccessfulToolRun({
          ...completion,
          result: outcome.result,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        const content = `Tool ${completion.toolCall.name} failed after ${retryStageLabel(outcome.stage)}: ${errorMessage(error)}`;
        return this.publishRetryTerminal({
          ...completion,
          content,
          processed: true,
          resultPreview,
          status: 'error',
        });
      }
    }
    return this.publishRetryTerminal({
      ...completion,
      content: outcome.content,
      processed: outcome.processed,
      resultPreview,
      status: outcome.status,
    });
  }

  private async publishRetryTerminal({
    content,
    outputDeltaPublishes,
    parsedArguments,
    processed,
    resultPreview,
    startedAtMs,
    status,
    toolCall,
  }: ToolRunCompletionInput & {
    content: string;
    processed: boolean;
    resultPreview?: string;
    status: 'error' | 'rejected';
  }): Promise<ToolOrchestratorRunResult> {
    await Promise.all(outputDeltaPublishes);
    await this.options.events.publishToolCompleted(
      toolCall,
      parsedArguments,
      status,
      content,
      { resultPreview, startedAtMs },
    );
    return { content, processed, status };
  }
}

function retryStageLabel(stage: ToolRetryStage): string {
  switch (stage) {
    case 'network':
      return 'network retry';
    case 'sandbox_readable_root':
      return 'sandbox readable-root retry';
    case 'sandbox_bypass':
      return 'sandbox retry';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { ToolApprovalStore } from './tool-approval-store.js';
