import {
  defaultModelMaxOutputTokens,
  normalizeModelIconConfig,
  RUNTIME_TASK_MODEL_IDS,
  type ProviderConfigState,
  type RuntimeTaskModelId,
  type RuntimeTaskModelSettings,
  type RuntimeTaskModelSettingsInput,
} from '@setsuna-desktop/contracts';

export const DEFAULT_LOCAL_TEST_MODEL_NAME = '本地测试模型';

export function normalizeProviderModels(
  models: ProviderConfigState['models'],
  provider: ProviderConfigState['provider'],
): ProviderConfigState['models'] {
  return models.map((model, index) => {
    const code = nonEmpty(model.code) ?? nonEmpty(model.id) ?? `model-${index + 1}`;
    const name = nonEmpty(model.name) ?? code;
    const icon = normalizeModelIconConfig(model.icon);
    return {
      id: nonEmpty(model.id) ?? code,
      // Replace only the old built-in display name; preserve custom names and model identity.
      name: code === 'local-runtime-smoke' && name === 'Local runtime smoke' ? DEFAULT_LOCAL_TEST_MODEL_NAME : name,
      code,
      enabled: model.enabled ?? true,
      ...(icon ? { icon } : {}),
      contextWindowTokens: positiveOptionalInt(model.contextWindowTokens),
      maxOutputTokens: positiveOptionalInt(model.maxOutputTokens) ?? defaultModelMaxOutputTokens(provider),
      thinkingEnabled: model.thinkingEnabled ?? false,
      thinkingEfforts: Array.isArray(model.thinkingEfforts) ? model.thinkingEfforts : [],
      defaultThinkingEffort: nonEmpty(model.defaultThinkingEffort),
      supportsImages: model.supportsImages ?? false,
    };
  });
}

export function taskModelSettingsForSave(
  input: RuntimeTaskModelSettingsInput | undefined,
  previous: RuntimeTaskModelSettings | undefined,
): RuntimeTaskModelSettings {
  const next = normalizeTaskModelSettings(previous);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return next;

  for (const taskId of RUNTIME_TASK_MODEL_IDS) {
    if (!Object.hasOwn(input, taskId)) continue;
    const reference = normalizeConfiguredModelReference(input[taskId]);
    if (reference) next[taskId] = reference;
    else delete next[taskId];
  }
  return next;
}

export function taskModelSettingsForState(
  stored: RuntimeTaskModelSettings | undefined,
): RuntimeTaskModelSettings {
  return normalizeTaskModelSettings(stored);
}

export function normalizeTaskModelSettings(value: unknown): RuntimeTaskModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const normalized: RuntimeTaskModelSettings = {};
  for (const taskId of RUNTIME_TASK_MODEL_IDS) {
    const reference = normalizeConfiguredModelReference(record[taskId]);
    if (reference) normalized[taskId] = reference;
  }
  return normalized;
}

export function normalizeConfiguredModelReference(
  value: unknown,
): RuntimeTaskModelSettings[RuntimeTaskModelId] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const providerId = nonEmpty(record.providerId);
  const modelId = nonEmpty(record.modelId);
  return providerId && modelId ? { providerId, modelId } : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
