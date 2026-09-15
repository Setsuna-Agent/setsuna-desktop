export type ModelProviderKind = 'openai-compatible' | 'openai-responses' | 'anthropic';

/** User-supplied headers replace the provider preset; an empty map disables that preset. */
export type ProviderRequestHeaders = Record<string, string>;

/** Validate at the persistence boundary as well as in the editor; never persist malformed HTTP fields. */
export function normalizeProviderRequestHeaders(value: unknown): ProviderRequestHeaders | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Request headers must be an object.');
  const seen = new Set<string>();
  const entries = Object.entries(value).map(([key, rawValue]): [string, string] => {
    const name = key.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name)) throw new Error('Invalid HTTP header name.');
    if (seen.has(name)) throw new Error('Duplicate HTTP header names are not allowed.');
    seen.add(name);
    // HTTP field values are byte strings. In particular, CR/LF must not reach a request.
    if (typeof rawValue !== 'string' || /[^\t\x20-\x7e\x80-\xff]/u.test(rawValue)) {
      throw new Error('Invalid HTTP header value.');
    }
    return [name, rawValue.trim()];
  });
  return Object.fromEntries(entries);
}
