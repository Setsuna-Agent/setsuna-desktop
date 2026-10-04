import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { activeTurnIdsInThread } from '../../../utils/runtime-turn-state.js';
import { managedGeneratedImageAssetIds } from '../../../utils/generated-image-assets.js';

export type ThreadCheckpointRecovery = {
  version: 1;
  activeTurnIds: string[];
  generatedImageAssetIds: string[];
};

/** Derived with the checkpoint, so recovery does not decode every historical message. */
export function checkpointRecoveryState(thread: RuntimeThread | null): ThreadCheckpointRecovery {
  return {
    version: 1,
    activeTurnIds: activeTurnIdsInThread(thread),
    generatedImageAssetIds: [...managedGeneratedImageAssetIds(thread)],
  };
}

export function isCheckpointRecoveryState(value: unknown): value is ThreadCheckpointRecovery {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ThreadCheckpointRecovery>;
  return state.version === 1 && isStringArray(state.activeTurnIds) && isStringArray(state.generatedImageAssetIds);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}
