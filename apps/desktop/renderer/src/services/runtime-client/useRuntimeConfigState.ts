import type {
  DesktopRuntimeClient,
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export type RuntimeConfigClient = Pick<
  DesktopRuntimeClient,
  'saveConfig'
>;

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'approvalPolicy'
  | 'approvalReviewer'
  | 'bypassHookTrust'
  | 'desktopSettings'
  | 'features'
  | 'globalPrompt'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'setsunaStyle'
>;

type RuntimeConfigStateOptions = {
  client: RuntimeConfigClient;
  modelProvider?: ModelProviderProjectionService;
};

export type ModelProviderProjectionService = Readonly<{
  providerProjection(): Readonly<{
    activeProviderId?: string;
    providers: ProviderConfigState[];
  }> | null;
  selectProviderModel(providerId: string, modelId: string): Promise<Readonly<{
    activeProviderId?: string;
    providers: ProviderConfigState[];
  }>>;
  subscribe(listener: () => void): () => void;
}>;

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
      ...(provider.catalogProviderId ? { catalogProviderId: provider.catalogProviderId } : {}),
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
export function useRuntimeConfigState({ client, modelProvider }: RuntimeConfigStateOptions) {
  const [config, setConfig] = useState<RuntimeConfigState | null>(null);
  const confirmedConfigRef = useRef<RuntimeConfigState | null>(null);
  const modelSelectionRequestRef = useRef(0);
  const modelSelectionSaveTailRef = useRef<Promise<void>>(Promise.resolve());

  const replaceConfig = useCallback((nextConfig: RuntimeConfigState) => {
    const merged = mergeProviderProjection(nextConfig, modelProvider?.providerProjection() ?? null);
    confirmedConfigRef.current = merged;
    setConfig(merged);
  }, [modelProvider]);

  useEffect(() => modelProvider?.subscribe(() => {
    const projection = modelProvider.providerProjection();
    if (!projection) return;
    setConfig((current) => {
      if (!current) return current;
      const merged = mergeProviderProjection(current, projection);
      confirmedConfigRef.current = merged;
      return merged;
    });
  }), [modelProvider]);

  const saveConfig = useCallback(async (input: RuntimeConfigInput) => {
    const nextConfig = await client.saveConfig(input);
    confirmedConfigRef.current = nextConfig;
    setConfig(nextConfig);
    return nextConfig;
  }, [client]);

  const saveRuntimePreferences = useCallback(
    async (input: RuntimePreferenceInput) => {
      await saveConfig(input);
    },
    [saveConfig],
  );

  const selectProviderModel = useCallback(
    async (providerId: string, modelId: string) => {
      if (!config) return;
      if (!modelProvider) throw new Error('Required model-provider Feature is unavailable.');
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
      const savedConfig = modelSelectionSaveTailRef.current.then(async () => {
        const projection = await modelProvider.selectProviderModel(providerId, modelId);
        return mergeProviderProjection(confirmedConfigRef.current ?? config, projection);
      });
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
    [config, modelProvider],
  );

  return {
    config,
    replaceConfig,
    saveRuntimePreferences,
    selectProviderModel,
  };
}

function mergeProviderProjection(
  config: RuntimeConfigState,
  projection: ReturnType<ModelProviderProjectionService['providerProjection']>,
): RuntimeConfigState {
  if (!projection) return config;
  return {
    ...config,
    activeProviderId: projection.activeProviderId,
    providers: projection.providers,
  };
}
