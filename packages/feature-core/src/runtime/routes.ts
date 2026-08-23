import { defineCapability, type CapabilityToken } from '../capability.js';
import type {
  FeatureOperationDescriptor,
  FeatureOperationErrorDefinitions,
} from '../operation.js';
import type { FeatureScope } from '../scope.js';

export type RuntimeFeatureRouteHandlerContext = Readonly<{
  signal: AbortSignal;
}>;

export interface RuntimeRouteRegistrar {
  register<TInput, TOutput, TErrors extends FeatureOperationErrorDefinitions>(
    scope: FeatureScope,
    operation: FeatureOperationDescriptor<TInput, TOutput, TErrors>,
    handler: (
      input: TInput,
      context: RuntimeFeatureRouteHandlerContext,
    ) => TOutput | PromiseLike<TOutput>,
  ): Readonly<{ dispose(): void }>;
}

export const runtimeRouteRegistrarCapability: CapabilityToken<RuntimeRouteRegistrar> = defineCapability({
  id: 'runtime.feature-routes',
  major: 1,
  description: 'Register codec-validated Feature routes on the authenticated runtime server',
});
