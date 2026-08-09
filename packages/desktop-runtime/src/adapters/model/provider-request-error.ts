const PROVIDER_ERROR_DETAIL_KEYS = [
  'name',
  'message',
  'responseBody',
  'data',
  'error',
  'cause',
] as const;

export class ProviderRequestError extends Error {
  readonly responseBody: string;
  readonly status: number;

  constructor(message: string, status: number, responseBody = '') {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Normalize SDK and native provider errors before feature-specific classification. */
export function providerErrorDetails(value: unknown): string {
  return collectProviderErrorDetails(value, new Set<object>(), 0);
}

function collectProviderErrorDetails(
  value: unknown,
  seen: Set<object>,
  depth: number,
): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as Record<string, unknown>;
  return PROVIDER_ERROR_DETAIL_KEYS
    .map((key) => collectProviderErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}
