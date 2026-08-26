import type { ModelRequest } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type ReviewTextGenerationRequest = Pick<
  ModelRequest,
  'messages' | 'maxOutputTokens' | 'signal' | 'temperature' | 'toolChoice'
>;

/** Host-owned model access kept deliberately narrower than the runtime model client. */
export interface ReviewRuntimeHost {
  isDefaultModelConfigured(): Promise<boolean>;
  generateText(input: ReviewTextGenerationRequest): Promise<string>;
}

export const reviewRuntimeHostCapability: CapabilityToken<ReviewRuntimeHost> = defineCapability({
  id: 'desktop-review.runtime-host',
  description: 'Host-managed default-model sampling boundary for Review',
});
