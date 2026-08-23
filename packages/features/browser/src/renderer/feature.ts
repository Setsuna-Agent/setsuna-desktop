import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { browserFeature } from '../contracts/index.js';
import { browserMessages } from './messages.js';

export const browserRendererFeature = defineRendererFeature({
  definition: browserFeature,
  dependencies: defineRendererDependencies({}),
  messages: [browserMessages],
  setup: () => undefined,
});
