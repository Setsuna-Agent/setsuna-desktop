import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { workspaceAppsFeature } from '../contracts/index.js';

export const workspaceAppsRendererFeature = defineRendererFeature({
  definition: workspaceAppsFeature,
  dependencies: defineRendererDependencies({}),
  setup() {},
});
