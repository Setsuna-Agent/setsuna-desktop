import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  FeatureSettingsRevisionConflictError,
  type RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/settings';
import type {
  ReviewControl,
  ReviewModelSelection,
  ReviewRuntimeHost,
  ReviewSettingsState,
  ReviewSettingsUpdate,
  StartReviewInput,
} from '../contracts/index.js';
import { createReviewTurnRequest } from './review-request.js';

type SelectionHandle = Pick<RuntimeFeatureSettingsDocumentHandle<
  ReviewModelSelection,
  ReviewModelSelection,
  ReviewModelSelection,
  undefined
>, 'read' | 'readPublic' | 'update'>;

/** Owns Agent Review input policy and delegates only the generic turn mutation to Core. */
export class RuntimeReviewControl implements ReviewControl {
  readonly available = true;

  constructor(
    private readonly settings: SelectionHandle,
    private readonly host: ReviewRuntimeHost,
  ) {}

  async readSettings(): Promise<ReviewSettingsState> {
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

  async updateSettings(input: ReviewSettingsUpdate): Promise<ReviewSettingsState> {
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

function settingsFailure(error: unknown): FeatureOperationFailure {
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
