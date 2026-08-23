import { FeatureEventRegistry } from '@setsuna-desktop/feature-core/events';
import {
  collaborationFeature,
  collaborationTaskCreatedEvent,
  collaborationTaskStatusChangedEvent,
  reduceCollaborationTaskCreated,
  reduceCollaborationTaskStatusChanged,
  type CollaborationState,
} from '../contracts/index.js';

export function createRendererCollaborationEventRegistry(): FeatureEventRegistry<CollaborationState> {
  const registry = new FeatureEventRegistry<CollaborationState>(collaborationFeature.id);
  registry.register(collaborationTaskCreatedEvent, reduceCollaborationTaskCreated);
  registry.register(collaborationTaskStatusChangedEvent, reduceCollaborationTaskStatusChanged);
  return registry;
}
