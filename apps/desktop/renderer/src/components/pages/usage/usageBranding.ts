import type { ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import { resolveModelBrand, resolveProviderBrand, type ProviderBrandAsset } from '../providerBranding.js';

export function usageProviderBrand(
  providers: ProviderConfigState[],
  providerName: string,
  providerId?: string,
): ProviderBrandAsset | null {
  const provider = findProvider(providers, providerId, providerName);
  return resolveProviderBrand(provider ?? { baseUrl: '', name: providerName });
}

export function usageModelBrand(
  providers: ProviderConfigState[],
  modelName: string,
  providerId?: string,
  providerName?: string,
): ProviderBrandAsset | null {
  const configuredProvider = findProvider(providers, providerId, providerName);
  const match = findModel(providers, modelName, configuredProvider);
  const provider = match?.provider ?? configuredProvider;
  const model = match?.model;
  return resolveModelBrand(
    model ?? { code: modelName, name: modelName },
    provider ?? { baseUrl: '', name: providerName ?? '' },
  );
}

function findProvider(
  providers: ProviderConfigState[],
  providerId?: string,
  providerName?: string,
): ProviderConfigState | undefined {
  if (providerId) {
    const byId = providers.find((provider) => provider.id === providerId);
    if (byId) return byId;
  }
  const normalizedName = normalizeIdentity(providerName);
  return normalizedName
    ? providers.find((provider) => normalizeIdentity(provider.name) === normalizedName || normalizeIdentity(provider.id) === normalizedName)
    : undefined;
}

function findModel(
  providers: ProviderConfigState[],
  modelName: string,
  preferredProvider?: ProviderConfigState,
): { model: ProviderModelConfig; provider: ProviderConfigState } | undefined {
  const normalizedModel = normalizeIdentity(modelName);
  if (!normalizedModel) return undefined;
  const candidates = preferredProvider ? [preferredProvider] : providers;
  for (const provider of candidates) {
    const model = provider.models.find((candidate) => (
      normalizeIdentity(candidate.code) === normalizedModel || normalizeIdentity(candidate.name) === normalizedModel
    ));
    if (model) return { model, provider };
  }
  return undefined;
}

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}
