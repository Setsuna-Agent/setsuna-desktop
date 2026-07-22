import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';

export type ChatModelOption = {
  key: string;
  model: ProviderModelConfig;
  provider: ProviderConfigState;
};

const modelPickerCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function chatModelOptions(config: RuntimeConfigState | null): ChatModelOption[] {
  if (!config) return [];
  return config.providers
    .filter((provider) => provider.enabled)
    // model.enabled 标记该厂商当前选中的模型，并不表示模型是否可供切换。
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: chatModelOptionKey(provider.id, model.id),
        provider,
        model,
      })),
    )
    .sort((left, right) => {
      const providerResult = modelPickerCollator.compare(modelProviderSortKey(left), modelProviderSortKey(right));
      if (providerResult) return providerResult;
      const modelResult = modelPickerCollator.compare(modelNameSortKey(left), modelNameSortKey(right));
      return modelResult || modelPickerCollator.compare(left.key, right.key);
    });
}

export function chatModelOptionKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function chatModelSearchText(option: ChatModelOption): string {
  return `${option.model.name} ${option.model.code} ${option.provider.name} ${option.provider.id}`.toLowerCase();
}

function modelProviderSortKey(option: ChatModelOption): string {
  return (option.provider.name || option.provider.id || '未命名厂商').toLowerCase();
}

function modelNameSortKey(option: ChatModelOption): string {
  return (option.model.name || option.model.code || '').toLowerCase();
}
