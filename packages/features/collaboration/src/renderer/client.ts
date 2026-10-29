import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readCollaborationState,
  type CollaborationStateSnapshot,
  actOnCollaborationTask, readCollaborationSettings, updateCollaborationSettings,
  type CollaborationUserAction, type CollaborationActionResult, type CollaborationSettingsState, type CollaborationSettingsUpdate,
} from '../contracts/index.js';

export interface CollaborationClient {
  act(input: CollaborationUserAction): Promise<CollaborationActionResult>;
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<CollaborationSettingsState>;
  updateSettings(input: CollaborationSettingsUpdate): Promise<CollaborationSettingsState>;
  readState(
    threadId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<CollaborationStateSnapshot>;
}

export function createCollaborationClient(transport: FeatureOperationTransport): CollaborationClient {
  return Object.freeze({
    act: (input: CollaborationUserAction) => transport.call(actOnCollaborationTask, input),
    readSettings: (options?: Readonly<{ signal?: AbortSignal }>) => transport.call(readCollaborationSettings, undefined, options),
    updateSettings: (input: CollaborationSettingsUpdate) => transport.call(updateCollaborationSettings, input),
    readState: (
      threadId: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(readCollaborationState, { threadId }, options),
  });
}
