import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';

export type ConfiguredTaskModelOption = Readonly<{
  label: string;
  model: ProviderModelConfig;
  provider: ProviderConfigState;
  reference: RuntimeConfiguredModelReference;
  value: string;
}>;

export function configuredTaskModelOptions(
  config: RuntimeConfigState,
): ConfiguredTaskModelOption[] {
  const seen = new Set<string>();
  const options: ConfiguredTaskModelOption[] = [];
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      const code = model.code.trim();
      const modelId = model.id.trim();
      const key = `${provider.id}\0${modelId}`;
      if (!code || !modelId || seen.has(key)) continue;
      seen.add(key);
      const reference = { providerId: provider.id, modelId };
      const modelLabel = model.name && model.name !== code
        ? `${model.name} (${code})`
        : code;
      options.push({
        label: `${provider.name} · ${modelLabel}`,
        model,
        provider,
        reference,
        value: configuredTaskModelReferenceValue(reference),
      });
    }
  }
  return options;
}

export function configuredTaskModelReferenceValue(
  reference: RuntimeConfiguredModelReference | undefined,
): string {
  return reference ? JSON.stringify([reference.providerId, reference.modelId]) : '';
}
