import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  FeatureSettingsRevisionConflictError,
  type RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/settings';
import type { ReviewModelSelection, ReviewRuntimeHost, ReviewSettingsState, ReviewSettingsUpdate } from '../contracts/index.js';

export type ReviewModelSettingsHandle = Pick<RuntimeFeatureSettingsDocumentHandle<
  ReviewModelSelection, ReviewModelSelection, ReviewModelSelection, undefined
>, 'read' | 'readPublic' | 'update'>;

/** Review and commit-message generation keep independent selections with the same save semantics. */
export async function readReviewModelSettings(
  settings: ReviewModelSettingsHandle,
  host: Pick<ReviewRuntimeHost, 'listModelOptions'>,
): Promise<ReviewSettingsState> {
  try {
    const [current, availableModels] = await Promise.all([settings.readPublic(), host.listModelOptions()]);
    return Object.freeze({ selection: current.value, revision: current.revision, availableModels });
  } catch (error) {
    throw settingsFailure(error);
  }
}

export async function updateReviewModelSettings(
  settings: ReviewModelSettingsHandle,
  host: Pick<ReviewRuntimeHost, 'listModelOptions'>,
  input: ReviewSettingsUpdate,
): Promise<ReviewSettingsState> {
  try {
    await settings.update({ expectedRevision: input.expectedRevision, patch: input.selection });
    return await readReviewModelSettings(settings, host);
  } catch (error) {
    throw settingsFailure(error);
  }
}

export function settingsFailure(error: unknown): FeatureOperationFailure {
  if (error instanceof FeatureOperationFailure) return error;
  if (error instanceof FeatureSettingsRevisionConflictError) {
    return new FeatureOperationFailure({
      code: 'REVISION_CONFLICT',
      message: 'Review settings changed. Reload before saving again.',
      retryable: true,
    });
  }
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: 'Review settings are unavailable.',
    retryable: true,
  });
}
