import type {
  RuntimeAvailableModelsResponse,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  copyModelProviderApiKey,
  type CopyModelProviderApiKeyInput,
  discoverModelProviderModels,
  readModelProviderCatalog,
  refreshModelProviderCatalog,
  type RefreshModelProviderCatalogInput,
  type RefreshModelProviderCatalogResult,
  readModelProviderSettings,
  updateModelProviderSettings,
  type ModelProviderSettingsInput,
  type ModelProviderSettingsState,
  type ModelProviderCatalog,
} from '../contracts/index.js';

export type ModelProviderClient = Readonly<{
  copyApiKey(input: CopyModelProviderApiKeyInput): Promise<Readonly<{ ok: true }>>;
  read(options?: Readonly<{ signal?: AbortSignal }>): Promise<ModelProviderSettingsState>;
  catalog(options?: Readonly<{ signal?: AbortSignal }>): Promise<ModelProviderCatalog>;
  refreshCatalog(input: RefreshModelProviderCatalogInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<RefreshModelProviderCatalogResult>;
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
    copyApiKey: (input) => transport.call(copyModelProviderApiKey, input),
    read: (options) => transport.call(readModelProviderSettings, undefined, options),
    catalog: (options) => transport.call(readModelProviderCatalog, undefined, options),
    refreshCatalog: (input, options) => transport.call(refreshModelProviderCatalog, input, options),
    save: (input, options) => transport.call(updateModelProviderSettings, input, options),
    discover: (input, options) => transport.call(discoverModelProviderModels, input, options),
  });
}
