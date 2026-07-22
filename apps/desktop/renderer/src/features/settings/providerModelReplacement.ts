import type { ProviderModelConfig } from '@setsuna-desktop/contracts';

export type ProviderModelReplacementDecision = 'apply' | 'confirm' | 'unchanged';

/** 在保护真实模型配置的同时，让只有占位项的供应商保持顺畅操作。 */
export function providerModelReplacementDecision(
  currentModels: ProviderModelConfig[],
  nextModels: ProviderModelConfig[],
): ProviderModelReplacementDecision {
  if (providerModelListsEqual(currentModels, nextModels)) return 'unchanged';
  return currentModels.some((model) => model.code.trim()) ? 'confirm' : 'apply';
}

export function providerModelListsEqual(left: ProviderModelConfig[], right: ProviderModelConfig[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((model, index) => providerModelsEqual(model, right[index]));
}

function providerModelsEqual(left: ProviderModelConfig, right: ProviderModelConfig | undefined): boolean {
  if (!right) return false;
  return left.id === right.id
    && left.name === right.name
    && left.code === right.code
    && left.enabled === right.enabled
    && left.contextWindowTokens === right.contextWindowTokens
    && left.maxOutputTokens === right.maxOutputTokens
    && left.thinkingEnabled === right.thinkingEnabled
    && left.defaultThinkingEffort === right.defaultThinkingEffort
    && left.supportsImages === right.supportsImages
    && stringListsEqual(left.thinkingEfforts, right.thinkingEfforts);
}

function stringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
