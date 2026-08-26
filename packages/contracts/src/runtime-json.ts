export type RuntimeJsonPrimitive = string | number | boolean | null;

export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

export type RuntimeJsonObject = {
  [key: string]: RuntimeJsonValue;
};

/** Converts an arbitrary value into a detached JSON-safe value. */
export function sanitizeRuntimeJsonValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): RuntimeJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object' || ancestors.has(value)) return undefined;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeRuntimeJsonValue(item, nextAncestors);
      return sanitized === undefined ? [] : [sanitized];
    });
  }

  const output: RuntimeJsonObject = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeRuntimeJsonValue(item, nextAncestors);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function sanitizeRuntimeJsonObject(value: unknown): RuntimeJsonObject | undefined {
  const sanitized = sanitizeRuntimeJsonValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : undefined;
}

export function runtimeJsonByteLength(value: RuntimeJsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
