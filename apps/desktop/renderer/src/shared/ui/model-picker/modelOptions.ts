import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import type { SettingsModelOption } from '@setsuna-desktop/renderer-contracts/settings';

export type ModelOption = {
  key: string;
  model: Pick<ProviderModelConfig, 'id' | 'name' | 'code' | 'icon' | 'contextWindowTokens' | 'supportsImages'>
    & Partial<Pick<ProviderModelConfig, 'maxOutputTokens' | 'thinkingEnabled'>>;
  provider: Pick<ProviderConfigState, 'id' | 'name' | 'baseUrl' | 'icon' | 'catalogProviderId'>;
};

type ModelOptionGroup = {
  provider: ModelOption['provider'];
  options: ModelOption[];
};

const modelPickerCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function modelOptions(config: Pick<RuntimeConfigState, 'providers'> | null): ModelOption[] {
  if (!config) return [];
  return config.providers
    .filter((provider) => provider.enabled)
    // model.enabled 标记该厂商当前选中的模型，并不表示模型是否可供切换。
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: modelOptionKey(provider.id, model.id),
        provider,
        model,
      })),
    )
    .sort(compareModelOptions);
}

/** Runtime availability owns the choices; the provider snapshot only enriches their presentation. */
export function configuredModelOptions(
  models: readonly SettingsModelOption[],
  config: Pick<RuntimeConfigState, 'providers'> | null,
): ModelOption[] {
  const configured = new Map(modelOptions(config).map((option) => [option.key, option]));
  return models.map((model) => {
    const key = modelOptionKey(model.providerId, model.modelId);
    const details = configured.get(key);
    return {
      key,
      provider: { ...details?.provider, id: model.providerId, name: model.providerName, baseUrl: details?.provider.baseUrl ?? '' },
      model: { ...details?.model, id: model.modelId, name: model.modelName, code: model.modelCode },
    };
  }).sort(compareModelOptions);
}

export function modelOptionKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function groupModelOptions(options: readonly ModelOption[]): ModelOptionGroup[] {
  const groups = new Map<string, ModelOptionGroup>();
  for (const option of options) {
    const group = groups.get(option.provider.id);
    if (group) group.options.push(option);
    else groups.set(option.provider.id, { provider: option.provider, options: [option] });
  }
  return Array.from(groups.values());
}

export function modelSearchText(option: ModelOption): string {
  return `${option.model.name} ${option.model.code} ${option.provider.name} ${option.provider.id}`.toLowerCase();
}

function compareModelOptions(left: ModelOption, right: ModelOption): number {
  const providerResult = modelPickerCollator.compare(modelProviderSortKey(left), modelProviderSortKey(right));
  if (providerResult) return providerResult;
  const modelResult = modelPickerCollator.compare(modelNameSortKey(left), modelNameSortKey(right));
  return modelResult || modelPickerCollator.compare(left.key, right.key);
}

function modelProviderSortKey(option: ModelOption): string {
  return (option.provider.name || option.provider.id || '未命名厂商').toLowerCase();
}

function modelNameSortKey(option: ModelOption): string {
  return (option.model.name || option.model.code || '').toLowerCase();
}
