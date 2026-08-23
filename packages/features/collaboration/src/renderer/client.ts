import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readCollaborationState,
  type CollaborationStateSnapshot,
} from '../contracts/index.js';

export interface CollaborationClient {
  readState(
    threadId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<CollaborationStateSnapshot>;
}

export function createCollaborationClient(transport: FeatureOperationTransport): CollaborationClient {
  return Object.freeze({
    readState: (
      threadId: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(readCollaborationState, { threadId }, options),
  });
}
