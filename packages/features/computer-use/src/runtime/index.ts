import { declareCapabilityProvider } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature } from '@setsuna-desktop/feature-core/runtime';
import { computerRuntimeToolsCapability, computerUseFeature } from '../contracts/index.js';
import { ComputerControlClient } from './control-client.js';
import { ComputerRuntimeTools } from './tools.js';
export const computerRuntimeFeature = defineRuntimeFeature({
  definition: computerUseFeature, dependencies: defineRuntimeDependencies({}),
  provides: [declareCapabilityProvider(computerRuntimeToolsCapability)],
  setup(context) {
    context.provide(declareCapabilityProvider(computerRuntimeToolsCapability), new ComputerRuntimeTools(ComputerControlClient.fromEnvironment()));
  },
});
