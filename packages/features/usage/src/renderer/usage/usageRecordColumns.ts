export const USAGE_RECORD_COLUMNS = [
  { key: 'model', label: 'model', width: 210 },
  { key: 'provider', label: 'provider', width: 140 },
  { key: 'source', label: 'source', width: 92 },
  { key: 'result', label: 'result', width: 80 },
  { key: 'tokens', label: 'totalTokens', width: 85 },
  { key: 'input', label: 'inputTokens', width: 96 },
  { key: 'cache', label: 'cacheHit', width: 92 },
  { key: 'output', label: 'outputTokens', width: 85 },
  { key: 'duration', label: 'duration', width: 80 },
  { key: 'speed', label: 'outputSpeed', width: 95 },
  { key: 'requestCount', label: 'callCount', width: 64 },
  { key: 'createdAt', label: 'callTime', width: 120 },
] as const;

export type UsageRecordColumnKey = typeof USAGE_RECORD_COLUMNS[number]['key'];
export const DEFAULT_USAGE_RECORD_COLUMNS: readonly UsageRecordColumnKey[] = [
  'model', 'source', 'result', 'tokens', 'cache', 'duration', 'speed', 'createdAt',
];

export function normalizeUsageRecordColumns(value: unknown): readonly UsageRecordColumnKey[] {
  if (!Array.isArray(value)) return DEFAULT_USAGE_RECORD_COLUMNS;
  const columns = USAGE_RECORD_COLUMNS.filter(({ key }) => value.includes(key)).map(({ key }) => key);
  return columns.length ? columns : DEFAULT_USAGE_RECORD_COLUMNS;
}
