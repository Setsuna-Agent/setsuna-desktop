import type {
  DesktopRuntimeClient,
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import { useCallback, useRef, useState } from 'react';

export type RuntimeConfigClient = Pick<
  DesktopRuntimeClient,
  'fetchProviderModels' | 'saveConfig'
>;

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'approvalPolicy'
  | 'approvalReviewer'
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
      proxyRoute: provider.proxyRoute,
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
      proxyRoute: provider.proxyRoute,
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
  const confirmedConfigRef = useRef<RuntimeConfigState | null>(null);
  const modelSelectionRequestRef = useRef(0);
  const modelSelectionSaveTailRef = useRef<Promise<void>>(Promise.resolve());

  const replaceConfig = useCallback((nextConfig: RuntimeConfigState) => {
    confirmedConfigRef.current = nextConfig;
    setConfig(nextConfig);
  }, []);

  const saveConfig = useCallback(async (input: RuntimeConfigInput) => {
    const nextConfig = await client.saveConfig(input);
    confirmedConfigRef.current = nextConfig;
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
      const requestId = modelSelectionRequestRef.current + 1;
      modelSelectionRequestRef.current = requestId;
      const input = providerModelSelectionConfigInput(config, providerId, modelId);
      const optimistic: RuntimeConfigState = {
        ...config,
        activeProviderId: input.activeProviderId,
        providers: config.providers.map((provider) => ({
          ...provider,
          enabled: provider.id === providerId ? true : provider.enabled,
          models: provider.models.map((model) => ({
            ...model,
            enabled: provider.id === providerId ? model.id === modelId : model.enabled,
          })),
        })),
      };
      // The composer reads the next-chat default synchronously, so an immediate send cannot
      // race the config round trip and accidentally dispatch the previously selected model.
      setConfig(optimistic);
      const savedConfig = modelSelectionSaveTailRef.current.then(() => (
        client.saveConfig(input)
      ));
      // Serialize model writes so late responses cannot apply an older selection after a newer one.
      modelSelectionSaveTailRef.current = savedConfig.then(
        () => undefined,
        () => undefined,
      );
      try {
        const saved = await savedConfig;
        confirmedConfigRef.current = saved;
        if (modelSelectionRequestRef.current === requestId) setConfig(saved);
      } catch (error) {
        if (modelSelectionRequestRef.current === requestId) {
          setConfig((current) => (
            current === optimistic && confirmedConfigRef.current
              ? confirmedConfigRef.current
              : current
          ));
        }
        throw error;
      }
    },
    [client, config],
  );

  return {
    config,
    fetchProviderModels,
    replaceConfig,
    saveProviders,
    saveRuntimePreferences,
    selectProviderModel,
  };
}
