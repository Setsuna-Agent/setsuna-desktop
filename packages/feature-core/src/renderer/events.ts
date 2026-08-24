import { defineCapability, type CapabilityToken } from '../capability.js';
import type { FeatureScope } from '../scope.js';

export type RendererFeatureEventFeedListener = (minimumThroughSeq: number) => void;

/**
 * Per-thread refresh signal exposed after the host accepts a matching Feature
 * event or completes a Core resync. Event payloads remain behind the host gate.
 */
export interface RendererFeatureEventFeed {
  subscribe(
    scope: FeatureScope,
    threadId: string,
    listener: RendererFeatureEventFeedListener,
  ): Readonly<{ dispose(): void }>;
}

export const rendererFeatureEventFeedCapability: CapabilityToken<RendererFeatureEventFeed> = defineCapability({
  id: 'renderer.feature-event-feed',
  description: 'Feature refresh signals behind the renderer global sequence gate',
});
