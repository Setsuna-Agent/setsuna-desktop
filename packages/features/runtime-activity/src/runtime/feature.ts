import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  listRuntimeActivities,
  listRuntimeActivityServices,
  runtimeActivityFeature,
  runtimeActivityRuntimeHostCapability,
  stopRuntimeActivityService,
  stopRuntimeActivityTask,
} from '../contracts/index.js';
import { projectRuntimeActivities } from './runtime-activity.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(runtimeActivityRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const runtimeActivityRuntimeFeature = defineRuntimeFeature({
  definition: runtimeActivityFeature,
  dependencies,
  setup(context) {
    const { host, routes } = context.dependencies;
    routes.register(context.scope, listRuntimeActivities, () => projectRuntimeActivities(host));
    routes.register(context.scope, listRuntimeActivityServices, async ({ threadId }) => ({
      services: await host.listBackgroundShellProcesses(threadId),
    }));
    routes.register(context.scope, stopRuntimeActivityTask, async ({ threadId, turnId }) => ({
      cancelled: await host.cancelTurn(threadId, turnId),
    }));
    routes.register(
      context.scope,
      stopRuntimeActivityService,
      ({ processId, threadId }) => host.terminateBackgroundShellProcess(threadId, processId),
    );
  },
});
