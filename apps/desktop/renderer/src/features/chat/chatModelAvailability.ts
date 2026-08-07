import type { ProviderConfigState, RuntimeConfigState } from '@setsuna-desktop/contracts';

// 内置 smoke provider 的模型 code，与 runtime 侧 configured-model-client 的判定保持一致：
// 启用的 provider 只有在已配置 API key，或选中模型不是 local-runtime-smoke 时，才算真实可用。
export const LOCAL_RUNTIME_SMOKE_MODEL_CODE = 'local-runtime-smoke';

export function hasRealModelConfigured(config: RuntimeConfigState | null): boolean {
  if (!config) return false;
  return config.providers.some(isProviderReadyForChat);
}

function isProviderReadyForChat(provider: ProviderConfigState): boolean {
  if (!provider.enabled) return false;
  // models 中 enabled 标记的是该厂商当前选中的模型，与 ChatModelPicker 的取值口径一致。
  const activeModel = provider.models.find((model) => model.enabled) ?? provider.models[0];
  if (!activeModel) return false;
  return provider.apiKeySet || activeModel.code !== LOCAL_RUNTIME_SMOKE_MODEL_CODE;
}
