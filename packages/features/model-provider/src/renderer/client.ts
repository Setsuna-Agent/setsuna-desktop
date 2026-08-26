import type {
  RuntimeAvailableModelsResponse,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  discoverModelProviderModels,
  readModelProviderCatalog,
  readModelProviderSettings,
  updateModelProviderSettings,
  type ModelProviderSettingsInput,
  type ModelProviderSettingsState,
  type ModelProviderCatalog,
} from '../contracts/index.js';

export type ModelProviderClient = Readonly<{
  read(options?: Readonly<{ signal?: AbortSignal }>): Promise<ModelProviderSettingsState>;
  catalog(options?: Readonly<{ signal?: AbortSignal }>): Promise<ModelProviderCatalog>;
  save(
    input: ModelProviderSettingsInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ModelProviderSettingsState>;
  discover(
    input: RuntimeFetchModelsInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeAvailableModelsResponse>;
}>;

export function createModelProviderClient(transport: FeatureOperationTransport): ModelProviderClient {
  return Object.freeze({
    read: (options) => transport.call(readModelProviderSettings, undefined, options),
    catalog: (options) => transport.call(readModelProviderCatalog, undefined, options),
    save: (input, options) => transport.call(updateModelProviderSettings, input, options),
    discover: (input, options) => transport.call(discoverModelProviderModels, input, options),
  });
}
