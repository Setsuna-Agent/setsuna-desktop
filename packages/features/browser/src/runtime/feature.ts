import { declareCapabilityProvider } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
} from '@setsuna-desktop/feature-core/runtime';
import {
  browserFeature,
  browserRuntimeToolServiceCapability,
} from '../contracts/index.js';
import { BrowserRuntimeTools } from './browser-runtime-tools.js';
import { HttpBrowserControlClient } from './http-browser-control-client.js';

export const browserRuntimeFeature = defineRuntimeFeature({
  definition: browserFeature,
  dependencies: defineRuntimeDependencies({}),
  provides: [declareCapabilityProvider(browserRuntimeToolServiceCapability)],
  setup(context) {
    const tools = new BrowserRuntimeTools(HttpBrowserControlClient.fromEnvironment());
    context.provide(declareCapabilityProvider(browserRuntimeToolServiceCapability), tools);
  },
});
