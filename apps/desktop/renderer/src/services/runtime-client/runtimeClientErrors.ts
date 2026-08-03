export function runtimeClientErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRuntimeTransportFailure(error: unknown): boolean {
  const message = runtimeClientErrorMessage(error);
  return (
    /\bRuntime request transport failed\b/iu.test(message)
    || /\bruntime:request\b[\s\S]*\bfetch failed\b/iu.test(message)
  );
}

/**
 * Snapshot, usage, and capability refreshes are best-effort projections. They keep
 * their last valid state and retry later instead of replacing a healthy streaming
 * conversation with a global fatal-error banner.
 */
export function reportRuntimeBackgroundFailure(operation: string, error: unknown): void {
  console.warn(
    `[runtime] Background ${operation} failed; keeping the last known state.`,
    error,
  );
}
