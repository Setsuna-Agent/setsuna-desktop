import {
  defaultModelMaxOutputTokens,
  type ModelProviderKind,
  type ProviderConfigState,
  type ProviderModelConfig,
} from '@setsuna-desktop/contracts';
import type {
  ModelProviderCatalog,
  ModelProviderCatalogModel,
  ModelProviderCatalogPlan,
  ModelProviderCatalogProvider,
} from '../contracts/index.js';

export const CUSTOM_PROVIDER_ID = '__custom__';

export function catalogProviderForConfig(
  provider: ProviderConfigState,
  catalog: ModelProviderCatalog,
): ModelProviderCatalogProvider | undefined {
  return provider.catalogProviderId
    ? catalog.providers.find((candidate) => candidate.id === provider.catalogProviderId)
    : undefined;
}

export function catalogPlanForConfig(
  provider: ProviderConfigState,
  catalogProvider: ModelProviderCatalogProvider | undefined,
): ModelProviderCatalogPlan | undefined {
  if (!catalogProvider) return undefined;
  const exact = catalogProvider.plans.find((plan) => (
    plan.provider === provider.provider
    && normalizeBaseUrl(plan.baseUrl) === normalizeBaseUrl(provider.baseUrl)
  ));
  return exact ?? catalogProvider.plans.find((plan) => plan.provider === provider.provider) ?? catalogProvider.plans[0];
}

export function attachInferredCatalogProviders(
  providers: readonly ProviderConfigState[],
  catalog: ModelProviderCatalog,
): ProviderConfigState[] {
  return providers.map((provider) => {
    // Missing identity is a legacy record eligible for migration. Explicit null is the user's custom-service choice.
    if (Object.hasOwn(provider, 'catalogProviderId')) return cloneProvider(provider);
    const match = inferCatalogProvider(provider, catalog);
    return match ? { ...cloneProvider(provider), catalogProviderId: match.id } : cloneProvider(provider);
  });
}

export function selectCatalogProvider(
  provider: ProviderConfigState,
  catalogProvider: ModelProviderCatalogProvider,
): ProviderConfigState {
  const plan = catalogProvider.plans[0];
  if (!plan) return provider;
  return {
    ...provider,
    catalogProviderId: catalogProvider.id,
    name: catalogProvider.name,
    provider: plan.provider,
    baseUrl: plan.baseUrl,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [],
  };
}

export function selectCatalogPlan(
  provider: ProviderConfigState,
  plan: ModelProviderCatalogPlan,
): ProviderConfigState {
  return {
    ...provider,
    provider: plan.provider,
    baseUrl: plan.baseUrl,
    models: [],
  };
}

export function detachCatalogProvider(provider: ProviderConfigState): ProviderConfigState {
  return {
    ...provider,
    catalogProviderId: null,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [],
  };
}

export function configuredModelFromCatalog(
  model: ModelProviderCatalogModel,
  selected: boolean,
): ProviderModelConfig {
  return {
    id: `model-${crypto.randomUUID()}`,
    name: model.name,
    code: model.code,
    enabled: selected,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    thinkingEnabled: model.thinkingEnabled,
    thinkingEfforts: [...model.thinkingEfforts],
    defaultThinkingEffort: model.defaultThinkingEffort,
    supportsImages: model.supportsImages,
  };
}

export function createCustomModel(provider: ModelProviderKind): ProviderModelConfig {
  return {
    id: `model-${crypto.randomUUID()}`,
    name: '',
    code: '',
    enabled: true,
    maxOutputTokens: defaultModelMaxOutputTokens(provider),
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
}

export function createProvider(catalog: ModelProviderCatalog): ProviderConfigState {
  const id = `provider-${crypto.randomUUID()}`;
  const first = catalog.providers[0];
  const firstPlan = first?.plans[0];
  return {
    id,
    name: first?.name ?? 'Custom provider',
    ...(first ? { catalogProviderId: first.id } : {}),
    provider: firstPlan?.provider ?? 'openai-compatible',
    baseUrl: firstPlan?.baseUrl ?? '',
    enabled: true,
    apiKeySet: false,
    apiKeyPreview: '',
    proxyRoute: { mode: 'inherit' },
    models: [],
  };
}

export function cloneProvider(provider: ProviderConfigState): ProviderConfigState {
  return { ...provider, models: provider.models.map((model) => ({ ...model })) };
}

function inferCatalogProvider(
  provider: ProviderConfigState,
  catalog: ModelProviderCatalog,
): ModelProviderCatalogProvider | undefined {
  const matching = catalog.providers.filter((candidate) => candidate.plans.some((plan) => (
    plan.provider === provider.provider
    && normalizeBaseUrl(plan.baseUrl) === normalizeBaseUrl(provider.baseUrl)
    && provider.models.every((model) => plan.models.some((catalogModel) => catalogModel.code === model.code))
  )));
  return matching.length === 1 ? matching[0] : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '').toLocaleLowerCase();
}
