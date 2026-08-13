import type {
  RuntimeApprovalReviewAssessment,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type {
  ApprovalReviewInput,
  ApprovalReviewer,
  ApprovalReviewResult,
} from '../../ports/approval-reviewer.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageStore } from '../../ports/usage-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import { abortReason } from '../core/runtime-turn-errors.js';
import { runtimeTaskModelRequest } from '../core/runtime-task-model.js';
import {
  approvalReviewAuditRationale,
  approvalReviewTechnicalFailureRationale,
  parseApprovalReviewOutput,
  policyConstrainedApprovalReviewOutcome,
} from './approval-review-output.js';
import { approvalReviewActionIdentity } from './approval-review-action.js';
import { buildApprovalReviewPrompt } from './approval-review-prompt.js';

const APPROVAL_REVIEW_TIMEOUT_MS = 60_000;
const APPROVAL_REVIEW_MAX_ATTEMPTS = 2;
const APPROVAL_REVIEW_MAX_OUTPUT_TOKENS = 1_200;
const MAX_TRACKED_TURNS = 100;
const MAX_REVIEW_HISTORY = 50;
const CONSECUTIVE_DENIAL_LIMIT = 3;
const ROLLING_DENIAL_LIMIT = 10;

type AutomaticApprovalReviewerOptions = {
  clock: Clock;
  configStore: ConfigStore;
  modelClient: ModelClient;
  threadStore: ThreadStore;
  usageStore?: UsageStore;
};

type AutomaticApprovalReviewerFactoryOptions = Omit<
  AutomaticApprovalReviewerOptions,
  'configStore'
> & {
  configStore?: ConfigStore;
};

type TurnReviewState = {
  consecutiveDenials: number;
  deniedActions: Map<string, RuntimeApprovalReviewAssessment>;
  history: boolean[];
};

/** Runs a narrow, tool-free model request for permission-boundary decisions. */
export class AutomaticApprovalReviewer implements ApprovalReviewer {
  private readonly turnReviews = new Map<string, TurnReviewState>();

  constructor(private readonly options: AutomaticApprovalReviewerOptions) {}

  async review(input: ApprovalReviewInput): Promise<ApprovalReviewResult> {
    if (input.signal.aborted) throw abortReason(input.signal);
    const actionIdentity = approvalReviewActionIdentity(input);
    const priorDenial = actionIdentity
      ? this.turnReviews.get(input.request.turnId)?.deniedActions.get(actionIdentity)
      : undefined;
    if (priorDenial) {
      const assessment: RuntimeApprovalReviewAssessment = {
        ...priorDenial,
        rationale: `This exact action was already denied. ${priorDenial.rationale}`,
      };
      return {
        assessment,
        ...(this.recordOutcome(input.request.turnId, true) ? { interruptTurn: true } : {}),
      };
    }

    const [config, thread] = await Promise.all([
      this.options.configStore.getConfig().catch(() => null),
      this.options.threadStore.getThread(input.request.threadId).catch(() => null),
    ]);
    if (input.signal.aborted) throw abortReason(input.signal);
    if (!config || !thread) {
      return this.failedResult(
        input.request.turnId,
        'Automatic approval review could not load the current runtime context.',
      );
    }

    const modelRequest = runtimeTaskModelRequest(
      config,
      'approvalReview',
      'local-runtime-smoke',
    );
    const prompt = buildApprovalReviewPrompt(
      input,
      thread,
      this.options.clock.now().toISOString(),
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
        const output = createModelStreamTextCollector();
        for await (const event of this.options.modelClient.stream({
          ...modelRequest,
          messages: prompt.messages,
          toolChoice: 'none',
          maxOutputTokens: APPROVAL_REVIEW_MAX_OUTPUT_TOKENS,
          temperature: 0,
          thinking: false,
          signal: reviewSignal,
        })) {
          output.consume(event);
          if (event.type === 'usage' || event.type === 'token_count') usage = event.usage;
        }
        await this.recordUsage(input, usage);
        const parsed = parseApprovalReviewOutput(output.text());
        if (!parsed) {
          lastFailure = 'Automatic approval review returned an invalid structured decision.';
          continue;
        }
        const outcome = policyConstrainedApprovalReviewOutcome(parsed);
        const rationale = approvalReviewAuditRationale(parsed, outcome);
        const auditModel = approvalReviewAuditModel(config, modelRequest, usage);
        const assessment: RuntimeApprovalReviewAssessment = {
          status: outcome === 'allow' ? 'allowed' : 'denied',
          riskLevel: parsed.riskLevel,
          userAuthorization: parsed.userAuthorization,
          rationale,
          ...(auditModel.providerId ? { providerId: auditModel.providerId } : {}),
          model: auditModel.model,
        };
        const denied = outcome === 'deny';
        return {
          assessment,
          ...(this.recordOutcome(
            input.request.turnId,
            denied,
            true,
            denied && actionIdentity ? { identity: actionIdentity, assessment } : undefined,
          )
            ? { interruptTurn: true }
            : {}),
        };
      } catch (error) {
        await this.recordUsage(input, usage);
        if (input.signal.aborted) throw abortReason(input.signal);
        if (timeoutSignal.aborted) {
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
    deniedAction?: { identity: string; assessment: RuntimeApprovalReviewAssessment },
  ): boolean {
    const state: TurnReviewState = this.turnReviews.get(turnId) ?? {
      consecutiveDenials: 0,
      deniedActions: new Map(),
      history: [],
    };
    state.consecutiveDenials = denied ? state.consecutiveDenials + 1 : 0;
    if (deniedAction) {
      state.deniedActions.set(deniedAction.identity, { ...deniedAction.assessment });
    }
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
    await this.options.usageStore?.recordUsage({
      threadId: input.request.threadId,
      turnId: input.request.turnId,
      createdAt: this.options.clock.now().toISOString(),
      ...usage,
    }).catch(() => undefined);
  }
}

export function createAutomaticApprovalReviewer(
  options: AutomaticApprovalReviewerFactoryOptions,
): ApprovalReviewer | undefined {
  if (!options.configStore) return undefined;
  return new AutomaticApprovalReviewer({
    clock: options.clock,
    configStore: options.configStore,
    modelClient: options.modelClient,
    threadStore: options.threadStore,
    usageStore: options.usageStore,
  });
}

function approvalReviewAuditModel(
  config: Awaited<ReturnType<ConfigStore['getConfig']>>,
  request: { model: string; providerId?: string },
  usage: RuntimeUsage | undefined,
): { model: string; providerId?: string } {
  const provider = request.providerId
    ? config.providers.find((item) => item.enabled && item.id === request.providerId)
    : config.providers.find((item) => item.enabled && item.id === config.activeProviderId)
      ?? config.providers.find((item) => item.enabled)
      ?? config.providers[0];
  const configuredModel = provider?.models.find((item) => item.code.trim() === request.model)
    ?? provider?.models.find((item) => item.enabled)
    ?? provider?.models[0];
  const providerId = usage?.providerId ?? provider?.id ?? request.providerId;
  return {
    model: usage?.model ?? configuredModel?.code.trim() ?? request.model,
    ...(providerId ? { providerId } : {}),
  };
}
