import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type {
  ReviewControl,
  ReviewRuntimeHost,
  ReviewSettingsUpdate,
  StartReviewInput,
} from '../contracts/index.js';
import { createReviewTurnRequest } from './review-request.js';
import { readReviewModelSettings, updateReviewModelSettings, type ReviewModelSettingsHandle } from './settings.js';

/** Owns Agent Review input policy and delegates only the generic turn mutation to Core. */
export class RuntimeReviewControl implements ReviewControl {
  readonly available = true;

  constructor(
    private readonly settings: ReviewModelSettingsHandle,
    private readonly host: ReviewRuntimeHost,
  ) {}

  readSettings() {
    return readReviewModelSettings(this.settings, this.host);
  }

  updateSettings(input: ReviewSettingsUpdate) {
    return updateReviewModelSettings(this.settings, this.host, input);
  }

  async start(input: StartReviewInput) {
    if (!await this.host.hasThread(input.threadId)) {
      throw new FeatureOperationFailure({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
        retryable: false,
        details: { threadId: input.threadId },
      });
    }

    const selection = await this.settings.read()
      .then((state) => state.value)
      .catch(() => null);
    const modelSelection = await this.host.resolveModelSelection({
      selection,
      fallback: input.modelSelection,
    });
    const request = createReviewTurnRequest(
      input.target,
      input.language ?? 'en-US',
      modelSelection,
      input.modelSelection,
    );
    try {
      return Object.freeze({
        request,
        response: await this.host.startTurn(input.threadId, request),
      });
    } catch (error) {
      if (error instanceof FeatureOperationFailure) throw error;
      throw new FeatureOperationFailure({
        code: 'REVIEW_NOT_STARTED',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  }
}
