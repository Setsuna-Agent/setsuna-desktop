import type { Provider } from '@earendil-works/pi-ai';
import type { RuntimeAvailableModel } from '@setsuna-desktop/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import {
  builtinCatalogProviderIdForConfig,
  catalogModelCapabilities,
  supportedProviders,
} from './provider-catalog.js';

type ModelCapabilities = ReturnType<typeof catalogModelCapabilities>;

export function supplementDiscoveredModels(
  models: RuntimeAvailableModel[],
  connection: Pick<ModelProviderRuntimeConfig, 'provider' | 'baseUrl' | 'catalogProviderId'>,
  providers: readonly Provider[] = supportedProviders(),
): RuntimeAvailableModel[] {
  const providerId = builtinCatalogProviderIdForConfig(connection, providers);
  const requestedIds = new Set(models.map((model) => model.id));
  const defaults = new Map<string, ModelCapabilities | null>();

  // Custom gateways can expose upstream IDs through another protocol. Copy only
  // capabilities; provider identity, transport settings and aliases stay untouched.
  for (const provider of providers) {
    if (providerId && provider.id !== providerId) continue;
    for (const model of provider.getModels()) {
      if (!requestedIds.has(model.id)) continue;
      const previous = defaults.get(model.id);
      if (previous === null) continue;
      const capabilities = catalogModelCapabilities(model);
      // A shared ID is safe only when every matching catalog agrees on its capabilities.
      defaults.set(model.id, previous && !isDeepStrictEqual(previous, capabilities) ? null : capabilities);
    }
  }

  return models.map((model) => {
    const capabilities = defaults.get(model.id);
    return capabilities ? supplementCapabilities(model, capabilities) : model;
  });
}

function supplementCapabilities(model: RuntimeAvailableModel, defaults: ModelCapabilities): RuntimeAvailableModel {
  const thinkingEnabled = model.thinkingEnabled
    ?? (model.thinkingEfforts?.length || model.defaultThinkingEffort ? true : defaults.thinkingEnabled);
  let thinkingEfforts = model.thinkingEfforts ?? (thinkingEnabled ? defaults.thinkingEfforts : []);
  // A catalog-supplied list must not invalidate the server's explicit default.
  if (model.thinkingEfforts === undefined && thinkingEnabled && model.defaultThinkingEffort
    && !thinkingEfforts.includes(model.defaultThinkingEffort)) {
    thinkingEfforts = [...thinkingEfforts, model.defaultThinkingEffort];
  }
  const defaultThinkingEffort = model.defaultThinkingEffort
    ?? (thinkingEnabled && defaults.defaultThinkingEffort && thinkingEfforts.includes(defaults.defaultThinkingEffort)
      ? defaults.defaultThinkingEffort
      : undefined);
  return {
    ...defaults,
    ...model,
    thinkingEnabled,
    thinkingEfforts,
    defaultThinkingEffort,
  };
}
