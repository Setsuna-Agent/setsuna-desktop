import type {
  RuntimeConfiguredModelReference,
  RuntimeTaskModelSettings,
} from '@setsuna-desktop/contracts';
import type { MemoryPreferences } from '@setsuna-desktop/feature-memory/contracts';
import { normalizeConfiguredModelReference } from './task-model-config.js';

/** Pre-Feature fields read once by the Memory migration adapter. */
export type LegacyRuntimeMemorySettings = {
  useMemories: boolean;
  generateMemories: boolean;
  disableOnExternalContext: boolean;
  extractModel?: string;
  consolidationModel?: string;
  minRateLimitRemainingPercent?: number;
  maxRolloutsPerStartup?: number;
  maxRolloutAgeDays?: number;
  minRolloutIdleHours?: number;
  maxUnusedDays?: number;
  maxRawMemoriesForConsolidation?: number;
};

export type StoredTaskModelSettings = RuntimeTaskModelSettings & {
  /** Compatibility input consumed once by the Review Feature. */
  review?: RuntimeConfiguredModelReference;
  /** Compatibility input consumed once by the Approval Review Feature. */
  approvalReview?: RuntimeConfiguredModelReference;
  /** Compatibility input consumed once by the Thread Title Generation Feature. */
  threadTitle?: RuntimeConfiguredModelReference;
  memoryExtraction?: RuntimeConfiguredModelReference;
  memoryConsolidation?: RuntimeConfiguredModelReference;
};

export function normalizeLegacyMemorySettings(
  value: unknown,
  legacyMemoryEnabled?: unknown,
): LegacyRuntimeMemorySettings {
  const legacyEnabled = typeof legacyMemoryEnabled === 'boolean' ? legacyMemoryEnabled : undefined;
  const fallback = legacyEnabled === undefined
    ? defaultMemorySettings()
    : { ...defaultMemorySettings(), useMemories: legacyEnabled, generateMemories: legacyEnabled };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  return {
    useMemories: booleanValue(record.useMemories, fallback.useMemories),
    generateMemories: booleanValue(record.generateMemories, fallback.generateMemories),
    disableOnExternalContext: booleanValue(record.disableOnExternalContext, fallback.disableOnExternalContext),
    extractModel: nonEmpty(record.extractModel),
    consolidationModel: nonEmpty(record.consolidationModel),
    minRateLimitRemainingPercent: percentOptionalInt(record.minRateLimitRemainingPercent),
    maxRolloutsPerStartup: positiveOptionalInt(record.maxRolloutsPerStartup),
    maxRolloutAgeDays: positiveOptionalInt(record.maxRolloutAgeDays),
    minRolloutIdleHours: positiveOptionalInt(record.minRolloutIdleHours),
    maxUnusedDays: positiveOptionalInt(record.maxUnusedDays),
    maxRawMemoriesForConsolidation: positiveOptionalInt(record.maxRawMemoriesForConsolidation),
  };
}

export function copyOptionalMemoryLimits(
  memory: LegacyRuntimeMemorySettings,
): Partial<MemoryPreferences> {
  return {
    ...(memory.minRateLimitRemainingPercent === undefined ? {} : { minRateLimitRemainingPercent: memory.minRateLimitRemainingPercent }),
    ...(memory.maxRolloutsPerStartup === undefined ? {} : { maxRolloutsPerStartup: memory.maxRolloutsPerStartup }),
    ...(memory.maxRolloutAgeDays === undefined ? {} : { maxRolloutAgeDays: memory.maxRolloutAgeDays }),
    ...(memory.minRolloutIdleHours === undefined ? {} : { minRolloutIdleHours: memory.minRolloutIdleHours }),
    ...(memory.maxUnusedDays === undefined ? {} : { maxUnusedDays: memory.maxUnusedDays }),
    ...(memory.maxRawMemoriesForConsolidation === undefined ? {} : { maxRawMemoriesForConsolidation: memory.maxRawMemoriesForConsolidation }),
  };
}

export function legacyMemoryTaskModels(
  settings: StoredTaskModelSettings | undefined,
): Pick<StoredTaskModelSettings, 'memoryExtraction' | 'memoryConsolidation'> {
  const extraction = normalizeConfiguredModelReference(settings?.memoryExtraction);
  const consolidation = normalizeConfiguredModelReference(settings?.memoryConsolidation);
  return {
    ...(extraction ? { memoryExtraction: extraction } : {}),
    ...(consolidation ? { memoryConsolidation: consolidation } : {}),
  };
}

function defaultMemorySettings(): LegacyRuntimeMemorySettings {
  return { useMemories: true, generateMemories: true, disableOnExternalContext: false };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function positiveOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function percentOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.floor(value)
    : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
