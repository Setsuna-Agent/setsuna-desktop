import {
  FeatureEventRegistry,
  type SequencedThreadEventRecord,
} from '@setsuna-desktop/feature-core/events';
import {
  collaborationFeature,
  collaborationTaskCodec,
  collaborationTaskCreatedEvent,
  collaborationTaskStatusChangedEvent,
  reduceCollaborationTaskCreated,
  reduceCollaborationTaskStatusChanged,
  type CollaborationState,
  type CollaborationTask,
  type CollaborationTaskStatusChange,
} from '../contracts/index.js';

export function createRuntimeCollaborationEventRegistry(): FeatureEventRegistry<CollaborationState> {
  const registry = new FeatureEventRegistry<CollaborationState>(collaborationFeature.id);
  registry.register(collaborationTaskCreatedEvent, reduceCollaborationTaskCreated);
  registry.register(collaborationTaskStatusChangedEvent, reduceCollaborationTaskStatusChanged);
  registry.registerLegacy(
    'collaboration.task_created',
    decodeLegacyTaskCreated,
    reduceCollaborationTaskCreated,
  );
  registry.registerLegacy(
    'collaboration.task_status_changed',
    decodeLegacyTaskStatusChanged,
    reduceCollaborationTaskStatusChanged,
  );
  return registry;
}

function decodeLegacyTaskCreated(record: SequencedThreadEventRecord): CollaborationTask {
  const payload = objectRecord(record.payload, 'Legacy collaboration task-created payload is invalid.');
  return collaborationTaskCodec.parse(payload.task);
}

function decodeLegacyTaskStatusChanged(record: SequencedThreadEventRecord): CollaborationTaskStatusChange {
  const payload = objectRecord(record.payload, 'Legacy collaboration task-status payload is invalid.');
  return collaborationTaskStatusChangedEvent.codecs[1]!.parse({
    taskId: payload.taskId,
    status: payload.status,
    ...(payload.activeTurnId !== undefined ? { activeTurnId: payload.activeTurnId } : {}),
    ...(payload.resultPreview !== undefined ? { resultPreview: payload.resultPreview } : {}),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
  }) as CollaborationTaskStatusChange;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
