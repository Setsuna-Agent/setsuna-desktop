import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  clearGoalState,
  readGoalState,
  updateGoalState,
  type GoalPatch,
  type GoalStateSnapshot,
} from '../contracts/index.js';

export interface GoalClient {
  readState(
    threadId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<GoalStateSnapshot>;
  updateState(
    threadId: string,
    patch: GoalPatch,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<GoalStateSnapshot>;
  clearState(
    threadId: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<GoalStateSnapshot>;
}

export function createGoalClient(transport: FeatureOperationTransport): GoalClient {
  const client: GoalClient = {
    readState: (threadId, options) => transport.call(readGoalState, { threadId }, options),
    updateState: (threadId, patch, options) => transport.call(
      updateGoalState,
      { threadId, patch },
      options,
    ),
    clearState: (threadId, options) => transport.call(clearGoalState, { threadId }, options),
  };
  return Object.freeze(client);
}
