import {
  defaultModelMaxOutputTokens,
  type ModelProviderKind,
  type ProviderModelConfig,
  type RuntimeAvailableModel,
} from '@setsuna-desktop/contracts';

export function mergeDiscoveredModels(
  current: readonly ProviderModelConfig[],
  discovered: readonly RuntimeAvailableModel[],
  provider: ModelProviderKind,
): ProviderModelConfig[] {
  const discoveredByCode = new Map(discovered.map((item) => [item.id, item]));
  const existingCodes = new Set(current.map((model) => model.code));
  // Code identifies the upstream model; multiple local configurations can share it with different IDs and overrides.
  const synchronized = current.map((model) => {
    const item = discoveredByCode.get(model.code);
    return item ? configuredModelFromDiscovery(item, provider, model) : model;
  });
  let hasEnabledModel = current.some((model) => model.enabled);
  for (const item of discoveredByCode.values()) {
    if (existingCodes.has(item.id)) continue;
    synchronized.push({
      ...configuredModelFromDiscovery(item, provider),
      enabled: !hasEnabledModel,
    });
    hasEnabledModel = true;
  }
  return synchronized;
}

function configuredModelFromDiscovery(
  item: RuntimeAvailableModel,
  provider: ModelProviderKind,
  previous?: ProviderModelConfig,
): ProviderModelConfig {
  // Stored values may be deliberate overrides, including false and an empty effort list.
  const thinkingEnabled = previous?.thinkingEnabled ?? item.thinkingEnabled
    ?? Boolean(item.thinkingEfforts?.length || item.defaultThinkingEffort);
  const thinkingEfforts = previous?.thinkingEfforts ?? item.thinkingEfforts;
  // An omitted list does not constrain an explicit upstream default.
  const defaultThinkingEffort = previous?.defaultThinkingEffort
    ?? (thinkingEnabled && item.defaultThinkingEffort
      && (thinkingEfforts === undefined || thinkingEfforts.includes(item.defaultThinkingEffort))
      ? item.defaultThinkingEffort
      : undefined);
  return {
    id: previous?.id ?? `model-${crypto.randomUUID()}`,
    name: previous?.name ?? item.name,
    code: item.id,
    enabled: previous?.enabled ?? false,
    icon: previous?.icon,
    contextWindowTokens: previous?.contextWindowTokens ?? item.contextWindowTokens,
    maxOutputTokens: previous?.maxOutputTokens ?? item.maxOutputTokens ?? defaultModelMaxOutputTokens(provider),
    thinkingEnabled,
    thinkingEfforts: thinkingEfforts ?? [],
    defaultThinkingEffort,
    supportsImages: previous?.supportsImages ?? item.supportsImages,
  };
}
