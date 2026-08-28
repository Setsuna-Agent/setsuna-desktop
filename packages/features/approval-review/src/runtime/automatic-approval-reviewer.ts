import type {
  RuntimeApprovalReviewAssessment,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureOperationCancelledError } from '@setsuna-desktop/feature-core/status';
import {
  FeatureSettingsRevisionConflictError,
  type RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/settings';
import type {
  ApprovalReviewControl,
  ApprovalReviewInput,
  ApprovalReviewModelSelection,
  ApprovalReviewResolvedModel,
  ApprovalReviewResult,
  ApprovalReviewRuntimeHost,
  ApprovalReviewSettingsState,
  ApprovalReviewSettingsUpdate,
} from '../contracts/index.js';
import {
  APPROVAL_REVIEW_RESPONSE_SCHEMA,
  approvalReviewAuditRationale,
  approvalReviewDisplayText,
  approvalReviewTechnicalFailureRationale,
  parseApprovalReviewOutput,
  policyConstrainedApprovalReviewOutcome,
} from './approval-review-output.js';
import { buildApprovalReviewPrompt } from './approval-review-prompt.js';

const APPROVAL_REVIEW_TIMEOUT_MS = 60_000;
const APPROVAL_REVIEW_MAX_ATTEMPTS = 2;
const MAX_TRACKED_TURNS = 100;
const MAX_REVIEW_HISTORY = 50;
const CONSECUTIVE_DENIAL_LIMIT = 3;
const ROLLING_DENIAL_LIMIT = 10;

type SelectionHandle = Pick<RuntimeFeatureSettingsDocumentHandle<
  ApprovalReviewModelSelection,
  ApprovalReviewModelSelection,
  ApprovalReviewModelSelection,
  undefined
>, 'read' | 'readPublic' | 'update'>;

type TurnReviewState = {
  consecutiveDenials: number;
  history: boolean[];
};

/** Runs narrow, tool-free model requests for permission-boundary decisions. */
export class AutomaticApprovalReviewControl implements ApprovalReviewControl {
  readonly available = true;
  private readonly turnReviews = new Map<string, TurnReviewState>();

  constructor(
    private readonly scope: FeatureScope,
    private readonly settings: SelectionHandle,
    private readonly host: ApprovalReviewRuntimeHost,
  ) {}

  async readSettings(): Promise<ApprovalReviewSettingsState> {
    try {
      const [current, availableModels] = await Promise.all([
        this.settings.readPublic(),
        this.host.listModelOptions(),
      ]);
      return Object.freeze({
        selection: current.value,
        revision: current.revision,
        availableModels,
      });
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  async updateSettings(input: ApprovalReviewSettingsUpdate): Promise<ApprovalReviewSettingsState> {
    try {
      await this.settings.update({
        expectedRevision: input.expectedRevision,
        patch: input.selection,
      });
      return this.readSettings();
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  async review(input: ApprovalReviewInput): Promise<ApprovalReviewResult> {
    try {
      return await this.scope.runOperation(
        (signal) => this.reviewScoped({ ...input, signal }),
        { signal: input.signal },
      );
    } catch (error) {
      // Feature scopes use their own cancellation type internally. The runtime
      // approval lifecycle consumes the standard AbortError contract so it can
      // resolve the pending automatic approval without falling back to the user.
      if (error instanceof FeatureOperationCancelledError) {
        throw approvalReviewCancellation(error);
      }
      throw error;
    }
  }

  private async reviewScoped(input: ApprovalReviewInput): Promise<ApprovalReviewResult> {
    const [selection, thread] = await Promise.all([
      this.settings.read().then((state) => state.value).catch(() => null),
      this.host.getThread(input.request.threadId).catch(() => null),
    ]);
    if (input.signal.aborted) throw abortReason(input.signal);
    if (!thread) {
      return this.failedResult(
        input.request.turnId,
        'Automatic approval review could not load the current runtime context.',
      );
    }

    let modelRequest: ApprovalReviewResolvedModel;
    try {
      modelRequest = await this.host.resolveModel({ selection, thread });
    } catch (error) {
      if (input.signal.aborted) throw abortReason(input.signal);
      return this.failedResult(
        input.request.turnId,
        approvalReviewTechnicalFailureRationale(error),
      );
    }
    const prompt = buildApprovalReviewPrompt(
      input,
      thread,
      this.host.now().toISOString(),
    );
    if ('unavailableReason' in prompt) {
      return this.failedResult(input.request.turnId, prompt.unavailableReason, modelRequest);
    }

    const timeoutSignal = AbortSignal.timeout(APPROVAL_REVIEW_TIMEOUT_MS);
    const reviewSignal = AbortSignal.any([input.signal, timeoutSignal]);
    let lastFailure = 'Automatic approval review returned no valid decision.';
    for (let attempt = 0; attempt < APPROVAL_REVIEW_MAX_ATTEMPTS; attempt += 1) {
      let usage: RuntimeUsage | undefined;
      try {
        const result = await this.host.generateText({
          ...modelRequest,
          messages: prompt.messages,
          toolChoice: 'none',
          temperature: 0,
          thinking: false,
          responseFormat: {
            type: 'json',
            name: 'approval_review_decision',
            description: 'One approval decision for the exact action under review.',
            schema: APPROVAL_REVIEW_RESPONSE_SCHEMA,
          },
          signal: reviewSignal,
        });
        usage = result.usage;
        await this.recordUsage(input, usage);
        const parsed = parseApprovalReviewOutput(result.content);
        if (!parsed) {
          lastFailure = 'Automatic approval review returned an invalid structured decision.';
          continue;
        }
        const outcome = policyConstrainedApprovalReviewOutcome(parsed);
        const rationale = approvalReviewAuditRationale(parsed, outcome);
        const auditModel = approvalReviewAuditModel(modelRequest, usage);
        const assessment: RuntimeApprovalReviewAssessment = {
          status: outcome === 'allow' ? 'allowed' : 'denied',
          riskLevel: parsed.riskLevel,
          userAuthorization: parsed.userAuthorization,
          rationale,
          riskSummary: approvalReviewDisplayText(parsed.rationale, input.arguments),
          ...(parsed.potentialImpact
            ? { potentialImpact: approvalReviewDisplayText(parsed.potentialImpact, input.arguments) }
            : {}),
          ...(auditModel.providerId ? { providerId: auditModel.providerId } : {}),
          model: auditModel.model,
        };
        const denied = outcome === 'deny';
        return {
          assessment,
          ...(this.recordOutcome(input.request.turnId, denied)
            ? { interruptTurn: true }
            : {}),
        };
      } catch (error) {
        await this.recordUsage(input, usage);
        if (input.signal.aborted) throw abortReason(input.signal);
        if (timeoutSignal.aborted || isTimeoutError(error)) {
          return this.technicalResult(
            input.request.turnId,
            'timed_out',
            'Automatic approval review timed out before returning a decision.',
            modelRequest,
          );
        }
        lastFailure = approvalReviewTechnicalFailureRationale(error);
      }
    }
    return this.technicalResult(
      input.request.turnId,
      'failed',
      lastFailure,
      modelRequest,
    );
  }

  private failedResult(
    turnId: string,
    rationale: string,
    modelRequest: { model: string; providerId?: string } = { model: 'unknown' },
  ): ApprovalReviewResult {
    return this.technicalResult(turnId, 'failed', rationale, modelRequest);
  }

  private technicalResult(
    turnId: string,
    status: 'failed' | 'timed_out',
    rationale: string,
    modelRequest: { model: string; providerId?: string },
  ): ApprovalReviewResult {
    this.recordOutcome(turnId, false, false);
    return {
      assessment: {
        status,
        rationale,
        ...(modelRequest.providerId ? { providerId: modelRequest.providerId } : {}),
        model: modelRequest.model,
      },
    };
  }

  private recordOutcome(
    turnId: string,
    denied: boolean,
    includeInHistory = true,
  ): boolean {
    const state: TurnReviewState = this.turnReviews.get(turnId) ?? {
      consecutiveDenials: 0,
      history: [],
    };
    state.consecutiveDenials = denied ? state.consecutiveDenials + 1 : 0;
    if (includeInHistory) {
      state.history.push(denied);
      if (state.history.length > MAX_REVIEW_HISTORY) state.history.shift();
    }
    this.turnReviews.delete(turnId);
    this.turnReviews.set(turnId, state);
    while (this.turnReviews.size > MAX_TRACKED_TURNS) {
      const oldestTurnId = this.turnReviews.keys().next().value as string | undefined;
      if (!oldestTurnId) break;
      this.turnReviews.delete(oldestTurnId);
    }
    const rollingDenials = state.history.reduce(
      (count, outcome) => count + (outcome ? 1 : 0),
      0,
    );
    return denied && (
      state.consecutiveDenials >= CONSECUTIVE_DENIAL_LIMIT
      || rollingDenials >= ROLLING_DENIAL_LIMIT
    );
  }

  private async recordUsage(
    input: ApprovalReviewInput,
    usage: RuntimeUsage | undefined,
  ): Promise<void> {
    if (!usage) return;
    await this.host.recordUsage(
      input.request.threadId,
      input.request.turnId,
      usage,
    ).catch(() => undefined);
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function approvalReviewAuditModel(
  request: { model: string; providerId?: string },
  usage: RuntimeUsage | undefined,
): { model: string; providerId?: string } {
  const providerId = usage?.providerId ?? request.providerId;
  return {
    model: usage?.model ?? request.model,
    ...(providerId ? { providerId } : {}),
  };
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Approval review cancelled.');
  error.name = 'AbortError';
  return error;
}

function approvalReviewCancellation(cause: FeatureOperationCancelledError): Error {
  const error = new Error(cause.message, { cause });
  error.name = 'AbortError';
  return error;
}

function settingsFailure(error: unknown): FeatureOperationFailure {
  if (error instanceof FeatureOperationFailure) return error;
  if (error instanceof FeatureSettingsRevisionConflictError) {
    return new FeatureOperationFailure({
      code: 'REVISION_CONFLICT',
      message: 'Approval review settings changed. Reload before saving again.',
      retryable: true,
    });
  }
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: 'Approval review settings are unavailable.',
    retryable: true,
  });
}
