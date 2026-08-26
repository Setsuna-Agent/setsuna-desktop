const MODEL_ERROR_DETAIL_KEYS = [
  'name',
  'message',
  'responseBody',
  'data',
  'error',
  'cause',
] as const;

/** Normalize nested SDK errors before model-independent failure classification. */
export function modelErrorDetails(value: unknown): string {
  return collectModelErrorDetails(value, new Set<object>(), 0);
}

function collectModelErrorDetails(
  value: unknown,
  seen: Set<object>,
  depth: number,
): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as Record<string, unknown>;
  return MODEL_ERROR_DETAIL_KEYS
    .map((key) => collectModelErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}
