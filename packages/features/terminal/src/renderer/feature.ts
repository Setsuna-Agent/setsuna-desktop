import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { terminalFeature } from '../contracts/index.js';
import { terminalMessages } from './messages.js';

export const terminalRendererFeature = defineRendererFeature({
  definition: terminalFeature,
  dependencies: defineRendererDependencies({}),
  messages: [terminalMessages],
  setup: () => undefined,
});
