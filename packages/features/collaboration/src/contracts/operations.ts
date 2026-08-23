import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import {
  collaborationStateSnapshotCodec,
  type CollaborationStateSnapshot,
} from './state.js';

export type CollaborationThreadInput = Readonly<{ threadId: string }>;

const collaborationThreadInputCodec = defineRuntimeCodec<CollaborationThreadInput>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Collaboration operation input must be an object.');
  }
  const threadId = (value as Record<string, unknown>).threadId;
  if (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(threadId)) {
    throw new Error('Collaboration threadId is invalid.');
  }
  return Object.freeze({ threadId });
});

const collaborationThreadErrors = Object.freeze({
  THREAD_NOT_FOUND: Object.freeze({ status: 404 }),
});

export const readCollaborationState = defineFeatureOperation<
  CollaborationThreadInput,
  CollaborationStateSnapshot,
  typeof collaborationThreadErrors
>({
  id: 'collaboration.state.read',
  method: 'GET',
  path: '/v1/features/collaboration/threads/:threadId/state',
  input: collaborationThreadInputCodec,
  output: collaborationStateSnapshotCodec,
  errors: collaborationThreadErrors,
  idempotency: 'safe',
});
