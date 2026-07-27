/**
 * Normalizes untrusted boundary input to a record without accepting arrays.
 *
 * Callers that need validation or coercion should layer their domain-specific
 * rules on top of this narrow structural check.
 */
export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
