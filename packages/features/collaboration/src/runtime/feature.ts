import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  createFeatureProjectionStore,
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  collaborationControlCapability,
  collaborationFeature,
  collaborationRuntimeHostCapability,
  createInitialCollaborationState,
  readCollaborationState,
  type CollaborationState,
} from '../contracts/index.js';
import { createRuntimeCollaborationEventRegistry } from './collaboration-event-registry.js';
import { RuntimeCollaborationCoordinator } from './runtime-collaboration-coordinator.js';
import { CollaborationThreadNotFoundError } from './runtime-collaboration-errors.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  threadEvents: requiredCapability(threadEventReaderCapability),
  host: requiredCapability(collaborationRuntimeHostCapability),
});

export const collaborationRuntimeFeature = defineRuntimeFeature({
  definition: collaborationFeature,
  provides: [declareCapabilityProvider(collaborationControlCapability)],
  dependencies,
  setup(context) {
    const registry = createRuntimeCollaborationEventRegistry();
    const projection = createFeatureProjectionStore<CollaborationState>({
      eventReader: context.dependencies.threadEvents,
      initialState: createInitialCollaborationState,
      reduce: (state, record) => registry.reduce(state, record),
    });
    context.scope.track(projection, (store) => store.dispose());

    const control = new RuntimeCollaborationCoordinator({
      host: context.dependencies.host,
      projection,
      onProjectionFailure: (threadId) => {
        context.health.setCondition(`projection:${threadId}`, {
          code: 'COLLABORATION_PROJECTION_UNAVAILABLE',
          message: 'Collaboration state could not be reconstructed for one or more threads.',
        });
      },
    });
    context.scope.add(() => control.shutdown());

    context.dependencies.routes.register(
      context.scope,
      readCollaborationState,
      async ({ threadId }) => {
        try {
          const snapshot = await control.readState(threadId);
          context.health.setCondition(`projection:${threadId}`, null);
          return snapshot;
        } catch (error) {
          if (error instanceof CollaborationThreadNotFoundError) {
            throw new FeatureOperationFailure({
              code: 'THREAD_NOT_FOUND',
              message: 'Thread not found.',
              retryable: false,
            });
          }
          context.health.setCondition(`projection:${threadId}`, {
            code: 'COLLABORATION_PROJECTION_UNAVAILABLE',
            message: 'Collaboration state could not be reconstructed for a thread.',
          });
          throw new FeatureOperationFailure({
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Collaboration state is unavailable.',
            retryable: true,
          });
        }
      },
    );
    context.provide(declareCapabilityProvider(collaborationControlCapability), control);
  },
});
