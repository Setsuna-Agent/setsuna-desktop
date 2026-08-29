import type {
  ReviewRendererService,
  ReviewTarget,
} from '@setsuna-desktop/feature-review/contracts';
import {
  ReviewRendererProvider,
  useReviewRendererService,
} from '@setsuna-desktop/feature-review/renderer';
import type { ReactNode } from 'react';

export type ReviewFeatureService = Pick<ReviewRendererService, 'start'>;
export type ReviewFeatureTarget = ReviewTarget;

/** Keeps Agent Review commands behind the renderer Feature composition boundary. */
export function ReviewFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: ReviewRendererService;
}>) {
  return (
    <ReviewRendererProvider service={service}>
      {children}
    </ReviewRendererProvider>
  );
}

export function useReviewFeatureService(): ReviewRendererService {
  return useReviewRendererService();
}
