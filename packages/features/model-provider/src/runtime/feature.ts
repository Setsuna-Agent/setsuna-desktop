import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  discoverModelProviderModels,
  modelProviderFeature,
  modelProviderRuntimeHostCapability,
  modelProviderSamplingCapability,
  readModelProviderCatalog,
  readModelProviderSettings,
  updateModelProviderSettings,
} from '../contracts/index.js';
import { PiModelClient } from './pi-model-client.js';
import { fetchAvailableModels, ModelDiscoveryInputError } from './model-discovery.js';
import { createModelProviderCatalog } from './provider-catalog.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(modelProviderRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});
const samplingProvider = declareCapabilityProvider(modelProviderSamplingCapability);

export const modelProviderRuntimeFeature = defineRuntimeFeature({
  definition: modelProviderFeature,
  dependencies,
  provides: [samplingProvider],
  setup(context) {
    context.dependencies.routes.register(
      context.scope,
      readModelProviderCatalog,
      () => createModelProviderCatalog(),
    );
    context.dependencies.routes.register(
      context.scope,
      readModelProviderSettings,
      () => context.dependencies.host.readProviderState(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateModelProviderSettings,
      (input) => context.dependencies.host.saveProviderState(input),
    );
    context.dependencies.routes.register(
      context.scope,
      discoverModelProviderModels,
      async (input, routeContext) => {
        try {
          const savedProvider = await context.dependencies.host.resolveProvider(input.providerId);
          return {
            models: await fetchAvailableModels(
              input,
              savedProvider,
              context.dependencies.host.fetchForRoute(input.proxyRoute ?? savedProvider?.proxyRoute),
              routeContext.signal,
            ),
          };
        } catch (error) {
          if (routeContext.signal.aborted) {
            throw routeContext.signal.reason ?? new DOMException('Aborted', 'AbortError');
          }
          throw modelDiscoveryFailure(error);
        }
      },
    );
    context.provide(samplingProvider, new PiModelClient(context.dependencies.host));
  },
});

function modelDiscoveryFailure(error: unknown): FeatureOperationFailure {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : '模型列表请求失败。';
  return new FeatureOperationFailure({
    code: error instanceof ModelDiscoveryInputError ? 'INVALID_INPUT' : 'PROVIDER_UNAVAILABLE',
    message,
    retryable: !(error instanceof ModelDiscoveryInputError),
  });
}
