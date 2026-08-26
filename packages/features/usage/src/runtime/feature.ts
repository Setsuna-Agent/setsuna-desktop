import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  queryUsage,
  usageControlCapability,
  usageFeature,
  usageRuntimeHostCapability,
} from '../contracts/index.js';
import { FileUsageStore } from './file-usage-store.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  host: requiredCapability(usageRuntimeHostCapability),
});

export const usageRuntimeFeature = defineRuntimeFeature({
  definition: usageFeature,
  dependencies,
  provides: [declareCapabilityProvider(usageControlCapability)],
  setup(context) {
    const store = new FileUsageStore(
      context.dependencies.host.dataDir,
      (prefix) => context.dependencies.host.id(prefix),
    );
    const control = Object.freeze({
      recordUsage: (input: Parameters<FileUsageStore['recordUsage']>[0]) => store.recordUsage(input),
      query: async (input = {}) => {
        // Provider metadata enriches historical records but is not required to read durable usage.
        const providers = await context.dependencies.host.listProviders().catch(() => []);
        return Object.freeze({
          providers: requestsProviderCatalog(input) ? providers : Object.freeze([]),
          usage: await store.getUsage(input, providers),
        });
      },
    });
    context.dependencies.routes.register(context.scope, queryUsage, (input) => control.query(input));
    context.provide(declareCapabilityProvider(usageControlCapability), control);
  },
});

function requestsProviderCatalog(input: Readonly<{
  threadId?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
}>): boolean {
  return input.threadId === undefined
    && input.limit === undefined
    && input.offset === undefined
    && input.from === undefined
    && input.to === undefined;
}
