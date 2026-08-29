import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readReviewSettings,
  startAgentReview,
  updateReviewSettings,
  type ReviewSettingsState,
  type ReviewSettingsUpdate,
  type StartReviewInput,
  type StartReviewResult,
} from '../contracts/index.js';

export type ReviewClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ReviewSettingsState>;
  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<StartReviewResult>;
  updateSettings(
    input: ReviewSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ReviewSettingsState>;
}>;

export function createReviewClient(transport: FeatureOperationTransport): ReviewClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readReviewSettings, undefined, options),
    start: (input, options) => transport.call(startAgentReview, input, options),
    updateSettings: (input, options) => transport.call(updateReviewSettings, input, options),
  });
}
