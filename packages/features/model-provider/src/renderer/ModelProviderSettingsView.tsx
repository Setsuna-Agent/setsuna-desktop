import {
  defaultModelMaxOutputTokens,
  type ProviderConfigInput,
  type ProviderConfigState,
  type ProviderModelConfig,
} from '@setsuna-desktop/contracts';
import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelProviderCatalog } from '../contracts/index.js';
import type { ModelProviderRendererHost } from './capabilities.js';
import { useModelProviderSnapshot } from './context.js';
import { ProviderEditor } from './ProviderEditor.js';
import { ProviderRail } from './ProviderRail.js';
import {
  attachInferredCatalogProviders,
  createProvider,
} from './provider-catalog.js';
import type { ModelProviderRendererStateService } from './service.js';

const EMPTY_CATALOG: ModelProviderCatalog = Object.freeze({ providers: Object.freeze([]) as never[] });

export function ModelProviderSettingsView({
  host,
  service,
  translate,
  ui,
}: Readonly<{
  host: ModelProviderRendererHost;
  service: ModelProviderRendererStateService;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const snapshot = useModelProviderSnapshot(service);
  const catalog = snapshot.catalog ?? EMPTY_CATALOG;
  const providers = useMemo(() => (
    snapshot.state && snapshot.catalog
      ? attachInferredCatalogProviders(snapshot.state.providers, snapshot.catalog)
      : []
  ), [snapshot.catalog, snapshot.state]);
  const activeProviderId = snapshot.state?.activeProviderId;
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [saveRevision, setSaveRevision] = useState(0);
  const [operationError, setOperationError] = useState('');
  const [discoveringProviderId, setDiscoveringProviderId] = useState<string>();
  const saveRevisionRef = useRef(0);
  const lastStartedRevisionRef = useRef(0);
  const discoveryRevisionRef = useRef(0);
  const providersRef = useRef(providers);
  const apiKeysRef = useRef(apiKeys);
  providersRef.current = providers;
  apiKeysRef.current = apiKeys;

  useEffect(() => {
    if (!providers.length) {
      setSelectedProviderId(undefined);
      return;
    }
    if (!selectedProviderId || !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(activeProviderId ?? providers[0]?.id);
    }
  }, [activeProviderId, providers, selectedProviderId]);

  useEffect(() => {
    if (saveRevision === 0) return;
    const revision = saveRevision;
    const timer = window.setTimeout(() => {
      lastStartedRevisionRef.current = revision;
      void service.commit().then(() => {
        if (revision !== saveRevisionRef.current) return;
        setOperationError('');
      }).catch((error: unknown) => {
        if (revision !== saveRevisionRef.current) return;
        setOperationError(errorMessage(error));
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [saveRevision, service]);

  useEffect(() => () => {
    const revision = saveRevisionRef.current;
    if (revision <= lastStartedRevisionRef.current) return;
    lastStartedRevisionRef.current = revision;
    void service.commit().catch((error: unknown) => console.error('[model-provider] failed to flush settings', error));
  }, [service]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);

  const stageProviders = (
    nextProviders: ProviderConfigState[],
    nextApiKeys = apiKeys,
    nextActiveProviderId = activeProviderId,
  ) => {
    service.stage({
      ...(nextActiveProviderId ? { activeProviderId: nextActiveProviderId } : {}),
      providers: nextProviders.map((provider) => providerInput(provider, nextApiKeys[provider.id])),
    }, {
      ...(nextActiveProviderId ? { activeProviderId: nextActiveProviderId } : {}),
      providers: nextProviders,
    });
    saveRevisionRef.current += 1;
    setOperationError('');
    setSaveRevision(saveRevisionRef.current);
  };
  const replaceProvider = (nextProvider: ProviderConfigState) => {
    stageProviders(providers.map((provider) => provider.id === nextProvider.id ? nextProvider : provider));
  };
  const replaceProviderIdentity = (nextProvider: ProviderConfigState) => {
    const nextApiKeys = Object.fromEntries(Object.entries(apiKeys).filter(([id]) => id !== nextProvider.id));
    setApiKeys(nextApiKeys);
    stageProviders(
      providers.map((provider) => provider.id === nextProvider.id
        ? { ...nextProvider, apiKeySet: false, apiKeyPreview: '' }
        : provider),
      nextApiKeys,
    );
  };
  const addProvider = () => {
    const provider = createProvider(catalog);
    const nextProviders = [...providers, provider];
    setSelectedProviderId(provider.id);
    stageProviders(nextProviders, apiKeys, activeProviderId ?? provider.id);
  };
  const removeProvider = () => {
    if (!selectedProvider || providers.length <= 1) return;
    const next = providers.filter((provider) => provider.id !== selectedProvider.id);
    const nextSelectedId = next[0]?.id;
    setSelectedProviderId(nextSelectedId);
    const nextActiveProviderId = activeProviderId === selectedProvider.id
      ? next.find((provider) => provider.enabled)?.id ?? nextSelectedId
      : activeProviderId;
    const nextApiKeys = Object.fromEntries(Object.entries(apiKeys).filter(([id]) => id !== selectedProvider.id));
    setApiKeys(nextApiKeys);
    stageProviders(next, nextApiKeys, nextActiveProviderId);
  };
  const discoverModels = async (): Promise<ProviderModelConfig[] | undefined> => {
    if (!selectedProvider) return undefined;
    const revision = ++discoveryRevisionRef.current;
    const input = {
      providerId: selectedProvider.id,
      catalogProviderId: selectedProvider.catalogProviderId ?? null,
      provider: selectedProvider.provider,
      baseUrl: selectedProvider.baseUrl,
      proxyRoute: selectedProvider.proxyRoute,
      apiKey: apiKeys[selectedProvider.id] || undefined,
    } satisfies ProviderConfigDiscoveryInput;
    setOperationError('');
    setDiscoveringProviderId(selectedProvider.id);
    try {
      const result = await service.discover(input);
      const currentProvider = providersRef.current.find((provider) => provider.id === input.providerId);
      if (
        revision !== discoveryRevisionRef.current
        || !currentProvider
        || !matchesDiscoveryInput(currentProvider, apiKeysRef.current[currentProvider.id], input)
      ) return undefined;
      return mergeDiscoveredModels(currentProvider.models, result.models, currentProvider.provider);
    } catch (error) {
      const currentProvider = providersRef.current.find((provider) => provider.id === input.providerId);
      if (
        revision !== discoveryRevisionRef.current
        || !currentProvider
        || !matchesDiscoveryInput(currentProvider, apiKeysRef.current[currentProvider.id], input)
      ) return undefined;
      setOperationError(translate('feature.modelProvider.discoveryFailed', { message: errorMessage(error) }));
      return undefined;
    } finally {
      if (revision === discoveryRevisionRef.current) setDiscoveringProviderId(undefined);
    }
  };

  return (
    <ui.Section className="model-provider-settings" featureId="model-provider">
      <ui.PageHeading
        description={translate('feature.modelProvider.description')}
        title={translate('feature.modelProvider.title')}
      />
      {operationError ? <ui.Toast message={operationError} tone="error" /> : null}
      {snapshot.loading && !snapshot.state ? (
        <ui.EmptyState title={translate('feature.modelProvider.loading')} />
      ) : snapshot.error && !snapshot.state ? (
        <ui.EmptyState title={snapshot.error} />
      ) : (
        <div className="model-provider-settings__layout">
          <ProviderRail
            host={host}
            providers={providers}
            selectedProviderId={selectedProviderId}
            translate={translate}
            ui={ui}
            onAdd={addProvider}
            onSelect={setSelectedProviderId}
          />
          {selectedProvider ? (
            <ProviderEditor
              key={selectedProvider.id}
              apiKey={apiKeys[selectedProvider.id] ?? ''}
              canDelete={providers.length > 1}
              catalog={catalog}
              discovering={discoveringProviderId === selectedProvider.id}
              host={host}
              provider={selectedProvider}
              proxyServers={snapshot.proxyServers}
              translate={translate}
              ui={ui}
              onApiKeyChange={(value) => {
                const nextApiKeys = { ...apiKeys, [selectedProvider.id]: value };
                setApiKeys(nextApiKeys);
                stageProviders(providers, nextApiKeys);
              }}
              onChange={replaceProvider}
              onDelete={removeProvider}
              onDiscover={discoverModels}
              onProviderIdentityChange={replaceProviderIdentity}
            />
          ) : (
            <div className="model-provider-settings__editor">
              <ui.EmptyState title={translate('feature.modelProvider.empty')} />
            </div>
          )}
        </div>
      )}
    </ui.Section>
  );
}

function providerInput(provider: ProviderConfigState, apiKey: string | undefined): ProviderConfigInput {
  return {
    id: provider.id,
    name: provider.name,
    catalogProviderId: provider.catalogProviderId ?? null,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    icon: provider.icon ?? null,
    proxyRoute: provider.proxyRoute,
    ...(apiKey ? { apiKey } : provider.apiKeySet ? {} : { clearApiKey: true }),
    models: provider.models,
  };
}

type ProviderConfigDiscoveryInput = Readonly<{
  providerId: string;
  catalogProviderId: string | null;
  provider: ProviderConfigState['provider'];
  baseUrl: string;
  proxyRoute: ProviderConfigState['proxyRoute'];
  apiKey: string | undefined;
}>;

function matchesDiscoveryInput(
  provider: ProviderConfigState,
  apiKey: string | undefined,
  input: ProviderConfigDiscoveryInput,
): boolean {
  return provider.id === input.providerId
    && (provider.catalogProviderId ?? null) === input.catalogProviderId
    && provider.provider === input.provider
    && provider.baseUrl === input.baseUrl
    && (apiKey || undefined) === input.apiKey
    && JSON.stringify(provider.proxyRoute ?? null) === JSON.stringify(input.proxyRoute ?? null);
}

function mergeDiscoveredModels(
  current: readonly ProviderModelConfig[],
  discovered: readonly Readonly<{
    id: string;
    name: string;
    contextWindowTokens?: number;
    maxOutputTokens?: number;
    thinkingEnabled?: boolean;
    thinkingEfforts?: string[];
    defaultThinkingEffort?: string;
    supportsImages?: boolean;
  }>[],
  provider: ProviderConfigState['provider'],
): ProviderModelConfig[] {
  const existing = new Map(current.map((model) => [model.code, model]));
  const retainedEnabledModel = discovered.some((item) => existing.get(item.id)?.enabled);
  const merged = discovered.map((item, index) => {
    const previous = existing.get(item.id);
    return {
      id: previous?.id ?? `model-${crypto.randomUUID()}`,
      name: item.name,
      code: item.id,
      enabled: previous?.enabled === true || (index === 0 && !retainedEnabledModel),
      icon: previous?.icon,
      contextWindowTokens: item.contextWindowTokens ?? previous?.contextWindowTokens,
      maxOutputTokens: item.maxOutputTokens ?? previous?.maxOutputTokens ?? defaultModelMaxOutputTokens(provider),
      thinkingEnabled: item.thinkingEnabled
        ?? (Boolean(item.thinkingEfforts?.length || item.defaultThinkingEffort)
          || previous?.thinkingEnabled === true),
      thinkingEfforts: item.thinkingEfforts ?? previous?.thinkingEfforts ?? [],
      defaultThinkingEffort: item.defaultThinkingEffort ?? previous?.defaultThinkingEffort,
      supportsImages: item.supportsImages ?? previous?.supportsImages,
    };
  });
  return merged;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
