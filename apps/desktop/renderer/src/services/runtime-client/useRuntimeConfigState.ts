import type {
  DesktopRuntimeClient,
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationTestInput,
} from '@setsuna-desktop/contracts';
import { useCallback, useState } from 'react';

export type RuntimeConfigClient = Pick<
  DesktopRuntimeClient,
  'fetchProviderModels' | 'saveConfig' | 'testImageGeneration'
>;

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'approvalPolicy'
  | 'bypassHookTrust'
  | 'desktopSettings'
  | 'features'
  | 'globalPrompt'
  | 'memory'
  | 'memoryEnabled'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'setsunaStyle'
>;

type RuntimeConfigStateOptions = {
  client: RuntimeConfigClient;
};

export function providerSaveConfigInput(
  providers: ProviderConfigState[],
  apiKeysByProviderId: Record<string, string>,
  currentActiveProviderId?: string,
): Pick<RuntimeConfigInput, 'activeProviderId' | 'providers'> {
  const activeProviderId = providers.some(
    (provider) => provider.id === currentActiveProviderId && provider.enabled,
  )
    ? currentActiveProviderId
    : providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id;

  return {
    activeProviderId,
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      icon: provider.icon ?? null,
      apiKey: apiKeysByProviderId[provider.id] || undefined,
      models: provider.models,
    })),
  };
}

export function providerModelSelectionConfigInput(
  config: RuntimeConfigState,
  providerId: string,
  modelId: string,
): Pick<RuntimeConfigInput, 'activeProviderId' | 'providers'> {
  return {
    activeProviderId: providerId,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      enabled: provider.id === providerId ? true : provider.enabled,
      icon: provider.icon ?? null,
      models: provider.models.map((model) => ({
        ...model,
        enabled: provider.id === providerId ? model.id === modelId : model.enabled,
      })),
    })),
  };
}

/**
 * Owns the shared runtime config document and its provider/preference commands.
 *
 * Capability mutations may replace this state through `replaceConfig`, but no other
 * renderer coordinator keeps a second config copy.
 */
export function useRuntimeConfigState({ client }: RuntimeConfigStateOptions) {
  const [config, setConfig] = useState<RuntimeConfigState | null>(null);

  const replaceConfig = useCallback((nextConfig: RuntimeConfigState) => {
    setConfig(nextConfig);
  }, []);

  const saveConfig = useCallback(async (input: RuntimeConfigInput) => {
    const nextConfig = await client.saveConfig(input);
    setConfig(nextConfig);
    return nextConfig;
  }, [client]);

  const saveProviders = useCallback(
    async (
      providers: ProviderConfigState[],
      apiKeysByProviderId: Record<string, string>,
    ) => {
      await saveConfig(providerSaveConfigInput(
        providers,
        apiKeysByProviderId,
        config?.activeProviderId,
      ));
    },
    [config?.activeProviderId, saveConfig],
  );

  const saveImageGenerationConfig = useCallback(
    async (input: RuntimeImageGenerationConfigInput) => {
      await saveConfig({ imageGeneration: input });
    },
    [saveConfig],
  );

  const testImageGeneration = useCallback(
    async (input: RuntimeImageGenerationTestInput) => (
      await client.testImageGeneration(input)
    ),
    [client],
  );

  const saveRuntimePreferences = useCallback(
    async (input: RuntimePreferenceInput) => {
      await saveConfig(input);
    },
    [saveConfig],
  );

  const fetchProviderModels = useCallback(
    async (input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse> => (
      client.fetchProviderModels(input)
    ),
    [client],
  );

  const selectProviderModel = useCallback(
    async (providerId: string, modelId: string) => {
      if (!config) return;
      await saveConfig(providerModelSelectionConfigInput(config, providerId, modelId));
    },
    [config, saveConfig],
  );

  return {
    config,
    fetchProviderModels,
    replaceConfig,
    saveImageGenerationConfig,
    saveProviders,
    saveRuntimePreferences,
    selectProviderModel,
    testImageGeneration,
  };
}
