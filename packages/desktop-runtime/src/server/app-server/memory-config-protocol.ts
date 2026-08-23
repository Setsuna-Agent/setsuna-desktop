import type {
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
} from '@setsuna-desktop/contracts';
import type {
  MemoryPreferences,
  MemoryPreferencesPatch,
} from '@setsuna-desktop/feature-memory/contracts';
import { AppServerRpcError } from './errors.js';
import {
  hasOwn,
  numericInput,
  recordInput,
  requiredPositiveInteger,
  stringInput,
} from './input.js';

/** Preserves the app-server compatibility schema while Memory owns the stored settings. */
export function appServerMemoryConfig(
  config: RuntimeConfigState,
  memory: MemoryPreferences,
): Record<string, unknown> {
  const extractionModel = configuredModelCode(config, memory.extractionModel) ?? memory.extractionModelCode;
  const consolidationModel = configuredModelCode(config, memory.consolidationModel) ?? memory.consolidationModelCode;
  return {
    disable_on_external_context: memory.disableOnExternalContext,
    generate_memories: memory.generateMemories,
    use_memories: memory.useMemories,
    ...(extractionModel ? { extract_model: extractionModel } : {}),
    ...(consolidationModel ? { consolidation_model: consolidationModel } : {}),
    ...(memory.minRateLimitRemainingPercent !== undefined ? { min_rate_limit_remaining_percent: memory.minRateLimitRemainingPercent } : {}),
    ...(memory.maxRolloutsPerStartup ? { max_rollouts_per_startup: memory.maxRolloutsPerStartup } : {}),
    ...(memory.maxRolloutAgeDays ? { max_rollout_age_days: memory.maxRolloutAgeDays } : {}),
    ...(memory.minRolloutIdleHours ? { min_rollout_idle_hours: memory.minRolloutIdleHours } : {}),
    ...(memory.maxUnusedDays ? { max_unused_days: memory.maxUnusedDays } : {}),
    ...(memory.maxRawMemoriesForConsolidation ? { max_raw_memories_for_consolidation: memory.maxRawMemoriesForConsolidation } : {}),
  };
}

export function appServerMemorySettingsInput(value: unknown): MemoryPreferencesPatch {
  const input = recordInput(value);
  return {
    ...optionalMemoryBoolean(input, ['disable_on_external_context', 'no_memories_if_mcp_or_web_search', 'disableOnExternalContext'], 'disableOnExternalContext'),
    ...optionalMemoryBoolean(input, ['generate_memories', 'generateMemories'], 'generateMemories'),
    ...optionalMemoryBoolean(input, ['use_memories', 'useMemories'], 'useMemories'),
    ...optionalMemoryString(input, ['extract_model', 'extractModel'], 'extractionModelCode'),
    ...optionalMemoryString(input, ['consolidation_model', 'consolidationModel'], 'consolidationModelCode'),
    ...optionalMemoryPercent(input, ['min_rate_limit_remaining_percent', 'minRateLimitRemainingPercent'], 'minRateLimitRemainingPercent'),
    ...optionalMemoryPositiveInteger(input, ['max_rollouts_per_startup', 'maxRolloutsPerStartup'], 'maxRolloutsPerStartup'),
    ...optionalMemoryPositiveInteger(input, ['max_rollout_age_days', 'maxRolloutAgeDays'], 'maxRolloutAgeDays'),
    ...optionalMemoryPositiveInteger(input, ['min_rollout_idle_hours', 'minRolloutIdleHours'], 'minRolloutIdleHours'),
    ...optionalMemoryPositiveInteger(input, ['max_unused_days', 'maxUnusedDays'], 'maxUnusedDays'),
    ...optionalMemoryPositiveInteger(input, ['max_raw_memories_for_consolidation', 'maxRawMemoriesForConsolidation'], 'maxRawMemoriesForConsolidation'),
  };
}

export function appServerMemorySettingInput(key: string, value: unknown): MemoryPreferencesPatch {
  switch (key) {
    case 'disable_on_external_context':
    case 'no_memories_if_mcp_or_web_search':
    case 'disableOnExternalContext': return { disableOnExternalContext: requiredMemoryBoolean(value, key) };
    case 'generate_memories':
    case 'generateMemories': return { generateMemories: requiredMemoryBoolean(value, key) };
    case 'use_memories':
    case 'useMemories': return { useMemories: requiredMemoryBoolean(value, key) };
    case 'extract_model':
    case 'extractModel': return { extractionModelCode: memoryStringValue(value, key) };
    case 'consolidation_model':
    case 'consolidationModel': return { consolidationModelCode: memoryStringValue(value, key) };
    case 'min_rate_limit_remaining_percent':
    case 'minRateLimitRemainingPercent': return { minRateLimitRemainingPercent: requiredMemoryPercent(value, key) };
    case 'max_rollouts_per_startup':
    case 'maxRolloutsPerStartup': return { maxRolloutsPerStartup: requiredPositiveInteger(value, key) };
    case 'max_rollout_age_days':
    case 'maxRolloutAgeDays': return { maxRolloutAgeDays: requiredPositiveInteger(value, key) };
    case 'min_rollout_idle_hours':
    case 'minRolloutIdleHours': return { minRolloutIdleHours: requiredPositiveInteger(value, key) };
    case 'max_unused_days':
    case 'maxUnusedDays': return { maxUnusedDays: requiredPositiveInteger(value, key) };
    case 'max_raw_memories_for_consolidation':
    case 'maxRawMemoriesForConsolidation': return { maxRawMemoriesForConsolidation: requiredPositiveInteger(value, key) };
    default: throw validationError(`Unsupported config key path: memories.${key}`);
  }
}

function configuredModelCode(config: RuntimeConfigState, reference: RuntimeConfiguredModelReference | null) {
  if (!reference) return undefined;
  return config.providers.find((provider) => provider.id === reference.providerId)
    ?.models.find((model) => model.id === reference.modelId)?.code.trim() || undefined;
}

function optionalMemoryBoolean(input: Record<string, unknown>, keys: string[], field: keyof MemoryPreferencesPatch): MemoryPreferencesPatch {
  for (const key of keys) if (hasOwn(input, key)) return { [field]: requiredMemoryBoolean(input[key], key) };
  return {};
}

function optionalMemoryString(input: Record<string, unknown>, keys: string[], field: keyof MemoryPreferencesPatch): MemoryPreferencesPatch {
  for (const key of keys) if (hasOwn(input, key)) return { [field]: memoryStringValue(input[key], key) };
  return {};
}

function optionalMemoryPositiveInteger(input: Record<string, unknown>, keys: string[], field: keyof MemoryPreferencesPatch): MemoryPreferencesPatch {
  for (const key of keys) if (hasOwn(input, key)) return { [field]: requiredPositiveInteger(input[key], key) };
  return {};
}

function optionalMemoryPercent(input: Record<string, unknown>, keys: string[], field: keyof MemoryPreferencesPatch): MemoryPreferencesPatch {
  for (const key of keys) if (hasOwn(input, key)) return { [field]: requiredMemoryPercent(input[key], key) };
  return {};
}

function requiredMemoryBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new AppServerRpcError(-32602, `memories.${name} must be a boolean`);
}

function memoryStringValue(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return stringInput(value) ?? null;
  throw new AppServerRpcError(-32602, `memories.${name} must be a string or null`);
}

function requiredMemoryPercent(value: unknown, name: string): number {
  const numeric = numericInput(value);
  if (numeric === undefined || numeric < 0 || numeric > 100 || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `memories.${name} must be between 0 and 100`);
  }
  return numeric;
}

function validationError(message: string): AppServerRpcError {
  return new AppServerRpcError(-32602, message, { config_write_error_code: 'configValidationError' });
}
