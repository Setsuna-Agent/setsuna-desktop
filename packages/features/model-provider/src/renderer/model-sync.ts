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
  const existing = new Map(current.map((model) => [model.code, model]));
  const retainedEnabledModel = discovered.some((item) => existing.get(item.id)?.enabled);
  return discovered.map((item, index) => {
    const previous = existing.get(item.id);
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
      enabled: previous?.enabled === true || (index === 0 && !retainedEnabledModel),
      icon: previous?.icon,
      contextWindowTokens: previous?.contextWindowTokens ?? item.contextWindowTokens,
      maxOutputTokens: previous?.maxOutputTokens ?? item.maxOutputTokens ?? defaultModelMaxOutputTokens(provider),
      thinkingEnabled,
      thinkingEfforts: thinkingEfforts ?? [],
      defaultThinkingEffort,
      supportsImages: previous?.supportsImages ?? item.supportsImages,
    };
  });
}
