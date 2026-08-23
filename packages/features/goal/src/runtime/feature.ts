import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  createFeatureProjectionStore,
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureEventRegistrarCapability,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  clearGoalState,
  goalControlCapability,
  goalFeature,
  goalRuntimeHostCapability,
  readGoalState,
  type GoalState,
  updateGoalState,
} from '../contracts/index.js';
import { createRuntimeGoalEventRegistry } from './goal-event-registry.js';
import { RuntimeGoalCoordinator } from './runtime-goal-coordinator.js';
import { GoalConflictError, GoalThreadNotFoundError } from './runtime-goal-errors.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  events: requiredCapability(runtimeFeatureEventRegistrarCapability),
  threadEvents: requiredCapability(threadEventReaderCapability),
  host: requiredCapability(goalRuntimeHostCapability),
});

export const goalRuntimeFeature = defineRuntimeFeature({
  definition: goalFeature,
  provides: [declareCapabilityProvider(goalControlCapability)],
  dependencies,
  setup(context) {
    const unhealthyThreads = new Set<string>();
    const registry = createRuntimeGoalEventRegistry();
    const projection = createFeatureProjectionStore<GoalState>({
      featureId: goalFeature.id,
      eventReader: context.dependencies.threadEvents,
      initialState: () => Object.freeze({ goal: null }),
      reduce: (state, record) => registry.reduce(state, record),
    });
    context.scope.track(projection, (store) => store.dispose());
    context.dependencies.events.registerProjection(context.scope, projection);

    const control = new RuntimeGoalCoordinator({
      host: context.dependencies.host,
      onProjectionFailure(threadId) {
        unhealthyThreads.add(threadId);
        context.health.markDegraded({
          code: 'GOAL_PROJECTION_UNAVAILABLE',
          message: 'Goal state could not be reconstructed for one or more threads.',
        });
      },
      projection,
    });
    context.scope.add(() => control.shutdown());

    const readHealthyState = async (threadId: string) => {
      try {
        const state = await control.readState(threadId);
        unhealthyThreads.delete(threadId);
        if (!unhealthyThreads.size) context.health.markActive();
        return state;
      } catch (error) {
        const domainFailure = goalDomainFailure(error);
        if (domainFailure) throw domainFailure;
        unhealthyThreads.add(threadId);
        context.health.markDegraded({
          code: 'GOAL_PROJECTION_UNAVAILABLE',
          message: 'Goal state could not be reconstructed for a thread.',
        });
        throw new FeatureOperationFailure({
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'Goal state is unavailable.',
          retryable: true,
          details: projectionFailureDetails(error),
        });
      }
    };

    context.dependencies.routes.register(
      context.scope,
      readGoalState,
      ({ threadId }) => readHealthyState(threadId),
    );
    context.dependencies.routes.register(
      context.scope,
      updateGoalState,
      async ({ threadId, patch }) => {
        try {
          await control.setGoal(threadId, patch);
        } catch (error) {
          throw goalDomainFailure(error) ?? error;
        }
        return readHealthyState(threadId);
      },
    );
    context.dependencies.routes.register(
      context.scope,
      clearGoalState,
      async ({ threadId }) => {
        try {
          await control.clearGoal(threadId);
        } catch (error) {
          throw goalDomainFailure(error) ?? error;
        }
        return readHealthyState(threadId);
      },
    );
    context.provide(declareCapabilityProvider(goalControlCapability), control);
  },
});

function goalDomainFailure(error: unknown): FeatureOperationFailure | null {
  if (error instanceof GoalThreadNotFoundError) {
    return new FeatureOperationFailure({
      code: 'THREAD_NOT_FOUND',
      message: 'Thread not found.',
      retryable: false,
    });
  }
  if (error instanceof GoalConflictError) {
    return new FeatureOperationFailure({
      code: 'GOAL_CONFLICT',
      message: error.message,
      retryable: false,
    });
  }
  return null;
}

function projectionFailureDetails(error: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const input = error as Record<string, unknown>;
  const details = Object.fromEntries([
    ['featureId', input.featureId],
    ['eventType', input.eventType],
    ['schemaVersion', input.schemaVersion],
    ['seq', input.seq],
  ].filter((entry): entry is [string, string | number] => (
    typeof entry[1] === 'string' || typeof entry[1] === 'number'
  )));
  return Object.keys(details).length ? Object.freeze(details) : undefined;
}
