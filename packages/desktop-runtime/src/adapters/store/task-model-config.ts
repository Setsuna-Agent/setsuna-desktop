import {
  RUNTIME_TASK_MODEL_IDS,
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
