import { defineCapability, type CapabilityToken } from '../capability.js';
import type { FeatureEventFeedItem } from '../events.js';
import type { FeatureScope } from '../scope.js';

export type RendererFeatureEventFeedListener = (item: FeatureEventFeedItem) => void;

/**
 * Per-thread feed exposed after the host has accepted the global SSE sequence.
 * The subscriber identity comes from its scope, so a Feature cannot inspect
 * another Feature's event payload.
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
  major: 1,
  description: 'Current-thread Feature event feed behind the renderer global sequence gate',
});
