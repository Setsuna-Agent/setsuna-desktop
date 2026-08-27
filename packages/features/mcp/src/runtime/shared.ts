export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
