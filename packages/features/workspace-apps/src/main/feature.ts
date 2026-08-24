import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { workspaceAppsFeature } from '../contracts/index.js';
import { registerWorkspaceAppsIpc } from './ipc.js';

export const workspaceAppsMainFeature = defineMainFeature({
  definition: workspaceAppsFeature,
  dependencies: defineMainDependencies({}),
  setup(context) {
    context.scope.add(registerWorkspaceAppsIpc(context.scope));
  },
});
