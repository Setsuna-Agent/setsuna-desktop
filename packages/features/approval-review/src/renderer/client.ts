import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readApprovalReviewSettings,
  updateApprovalReviewSettings,
  type ApprovalReviewSettingsState,
  type ApprovalReviewSettingsUpdate,
} from '../contracts/index.js';

export type ApprovalReviewClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ApprovalReviewSettingsState>;
  updateSettings(
    input: ApprovalReviewSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ApprovalReviewSettingsState>;
}>;

export function createApprovalReviewClient(
  transport: FeatureOperationTransport,
): ApprovalReviewClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readApprovalReviewSettings, undefined, options),
    updateSettings: (input, options) => transport.call(updateApprovalReviewSettings, input, options),
  });
}
