import { declareCapabilityProvider } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
} from '@setsuna-desktop/feature-core/runtime';
import {
  windowsSandboxFeature,
  windowsSandboxRuntimeServiceCapability,
} from '../contracts/index.js';
import { WindowsNativeSandboxService } from './windows-native-sandbox.js';

const serviceProvider = declareCapabilityProvider(windowsSandboxRuntimeServiceCapability);

export const windowsSandboxRuntimeFeature = defineRuntimeFeature({
  definition: windowsSandboxFeature,
  dependencies: defineRuntimeDependencies({}),
  provides: [serviceProvider],
  setup(context) {
    context.provide(serviceProvider, new WindowsNativeSandboxService());
  },
});
