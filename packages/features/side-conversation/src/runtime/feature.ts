import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  createSideConversation,
  sideConversationFeature,
  sideConversationRuntimeHostCapability,
} from '../contracts/index.js';
import {
  SideConversationInvalidParentError,
  SideConversationThreadNotFoundError,
} from './errors.js';
import {
  cleanupRuntimeSideConversations,
  createRuntimeSideConversation,
} from './side-conversation-service.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(sideConversationRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const sideConversationRuntimeFeature = defineRuntimeFeature({
  definition: sideConversationFeature,
  dependencies,
  async setup(context) {
    await cleanupRuntimeSideConversations(context.dependencies.host);
    context.dependencies.routes.register(
      context.scope,
      createSideConversation,
      async ({ parentThreadId }, { signal }) => {
        try {
          const thread = await createRuntimeSideConversation(
            context.dependencies.host,
            parentThreadId,
            { signal },
          );
          return Object.freeze({ threadId: thread.id });
        } catch (error) {
          if (error instanceof SideConversationThreadNotFoundError) {
            throw new FeatureOperationFailure({
              code: 'THREAD_NOT_FOUND',
              message: error.message,
              retryable: false,
            });
          }
          if (error instanceof SideConversationInvalidParentError) {
            throw new FeatureOperationFailure({
              code: 'INVALID_PARENT_THREAD',
              message: error.message,
              retryable: false,
            });
          }
          throw error;
        }
      },
    );
  },
});
