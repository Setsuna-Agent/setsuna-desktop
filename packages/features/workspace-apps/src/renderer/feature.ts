import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspaceAppsFeature } from '../contracts/index.js';
import { workspaceAppsMessages } from './messages.js';

export const workspaceAppsRendererFeature = defineRendererFeature({
  definition: workspaceAppsFeature,
  dependencies: defineRendererDependencies({}),
  messages: [workspaceAppsMessages],
  setup: () => undefined,
});
