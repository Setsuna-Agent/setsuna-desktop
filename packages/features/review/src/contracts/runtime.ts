import type {
  ModelRequest,
  RuntimeConfiguredModelReference,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type {
  ReviewStartOutcome,
  ReviewTurnRequest,
  StartReviewInput,
  StartReviewResult,
} from './agent-review.js';
import type { ReviewModelSelection } from './settings.js';

export type ReviewTextGenerationRequest = Pick<
  ModelRequest,
  'messages' | 'maxOutputTokens' | 'signal' | 'temperature' | 'toolChoice'
>;

export type ReviewModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
}>;

export type ReviewSettingsState = Readonly<{
  selection: ReviewModelSelection;
  revision: number;
  availableModels: readonly ReviewModelOption[];
}>;

export type ReviewSettingsUpdate = Readonly<{
  expectedRevision: number;
  selection: ReviewModelSelection;
}>;

/** Host-owned model access kept deliberately narrower than the runtime model client. */
export interface ReviewRuntimeHost {
  isDefaultModelConfigured(): Promise<boolean>;
  generateText(input: ReviewTextGenerationRequest): Promise<string>;
  hasThread(threadId: string): Promise<boolean>;
  listModelOptions(): Promise<readonly ReviewModelOption[]>;
  resolveModelSelection(input: Readonly<{
    fallback?: RuntimeConfiguredModelReference;
    selection: ReviewModelSelection;
  }>): Promise<RuntimeConfiguredModelReference | undefined>;
  startTurn(threadId: string, request: ReviewTurnRequest): Promise<StartReviewResult>;
}

/** The protocol-neutral Agent Review surface consumed by Core and compatibility adapters. */
export interface ReviewControl {
  readonly available: boolean;
  readSettings(): Promise<ReviewSettingsState>;
  start(input: StartReviewInput): Promise<ReviewStartOutcome>;
  updateSettings(input: ReviewSettingsUpdate): Promise<ReviewSettingsState>;
}

export interface ReviewLegacySettingsAdapter {
  read(): Promise<ReviewModelSelection>;
  retire(): Promise<void>;
}

export const reviewRuntimeHostCapability: CapabilityToken<ReviewRuntimeHost> = defineCapability({
  id: 'desktop-review.runtime-host',
  description: 'Host-managed default-model sampling boundary for Review',
});

export const reviewControlCapability: CapabilityToken<ReviewControl> = defineCapability({
  id: 'desktop-review.control',
  description: 'Agent Review request, policy, model selection, and turn-start control',
});

export const reviewLegacySettingsCapability: CapabilityToken<ReviewLegacySettingsAdapter> = defineCapability({
  id: 'desktop-review.legacy-settings',
  description: 'One-way reader and cleanup adapter for the legacy review task model',
});

export function createNoopReviewControl(): ReviewControl {
  const unavailable = (): never => {
    throw new FeatureOperationFailure({
      code: 'FEATURE_UNAVAILABLE',
      message: 'Review Feature is unavailable.',
      retryable: true,
    });
  };
  return Object.freeze({
    available: false,
    readSettings: async () => unavailable(),
    start: async () => unavailable(),
    updateSettings: async () => unavailable(),
  });
}
