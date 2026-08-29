import type { RuntimeReviewFinding } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { StartReviewInput, StartReviewResult } from './agent-review.js';

export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';

export type DesktopReviewFocusRequest = {
  finding?: RuntimeReviewFinding;
  line?: number;
  path: string;
  version: number;
};

export type DesktopReviewOpenHandler = (
  filePath?: string,
  line?: number,
  finding?: RuntimeReviewFinding,
) => void;

export interface ReviewRendererService {
  readonly available: boolean;
  start(
    input: StartReviewInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<StartReviewResult>;
}

export const reviewRendererServiceCapability: CapabilityToken<ReviewRendererService> = defineCapability({
  id: 'desktop-review.renderer-service',
  description: 'Typed renderer entrypoint for starting an Agent Review turn',
});

export function createNoopReviewRendererService(): ReviewRendererService {
  return Object.freeze({
    available: false,
    start: async () => {
      throw new FeatureOperationFailure({
        code: 'FEATURE_UNAVAILABLE',
        message: 'Review Feature is unavailable.',
        retryable: true,
      });
    },
  });
}
