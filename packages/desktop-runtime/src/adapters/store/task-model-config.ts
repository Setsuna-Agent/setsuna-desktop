import {
  RUNTIME_TASK_MODEL_IDS,
  type ProviderConfigState,
  type RuntimeMemorySettings,
  type RuntimeTaskModelId,
  type RuntimeTaskModelSettings,
  type RuntimeTaskModelSettingsInput,
} from '@setsuna-desktop/contracts';

export function taskModelSettingsForSave(
  input: RuntimeTaskModelSettingsInput | undefined,
  previous: RuntimeTaskModelSettings | undefined,
): RuntimeTaskModelSettings {
  const next = normalizeTaskModelSettings(previous);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return next;

  for (const taskId of RUNTIME_TASK_MODEL_IDS) {
    if (!Object.hasOwn(input, taskId)) continue;
    const reference = normalizeTaskModelReference(input[taskId]);
    if (reference) next[taskId] = reference;
    else delete next[taskId];
  }
  return next;
}

export function taskModelSettingsForState(
  stored: RuntimeTaskModelSettings | undefined,
  legacyMemory: RuntimeMemorySettings,
  providers: ProviderConfigState[],
  activeProviderId: string | undefined,
): RuntimeTaskModelSettings {
  const next = normalizeTaskModelSettings(stored);
  if (!next.memoryExtraction) {
    const legacy = legacyTaskModelReference(
      legacyMemory.extractModel,
      providers,
      activeProviderId,
    );
    if (legacy) next.memoryExtraction = legacy;
  }
  if (!next.memoryConsolidation) {
    const legacy = legacyTaskModelReference(
      legacyMemory.consolidationModel,
      providers,
      activeProviderId,
    );
    if (legacy) next.memoryConsolidation = legacy;
  }
  return next;
}

export function normalizeTaskModelSettings(value: unknown): RuntimeTaskModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const normalized: RuntimeTaskModelSettings = {};
  for (const taskId of RUNTIME_TASK_MODEL_IDS) {
    const reference = normalizeTaskModelReference(record[taskId]);
    if (reference) normalized[taskId] = reference;
  }
  return normalized;
}

function normalizeTaskModelReference(
  value: unknown,
): RuntimeTaskModelSettings[RuntimeTaskModelId] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const providerId = nonEmpty(record.providerId);
  const modelId = nonEmpty(record.modelId);
  return providerId && modelId ? { providerId, modelId } : undefined;
}

function legacyTaskModelReference(
  modelValue: string | undefined,
  providers: ProviderConfigState[],
  activeProviderId: string | undefined,
): RuntimeTaskModelSettings[RuntimeTaskModelId] | undefined {
  const modelCode = nonEmpty(modelValue);
  if (!modelCode) return undefined;
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const activeProvider = enabledProviders.find((provider) => provider.id === activeProviderId)
    ?? enabledProviders[0];
  const orderedProviders = activeProvider
    ? [activeProvider, ...enabledProviders.filter((provider) => provider.id !== activeProvider.id)]
    : enabledProviders;

  for (const provider of orderedProviders) {
    const model = provider.models.find((item) => item.code === modelCode || item.id === modelCode);
    if (model) return { providerId: provider.id, modelId: model.id };
  }
  return undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
