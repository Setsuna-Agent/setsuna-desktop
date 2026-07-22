export class TurnCancelledError extends Error {
  constructor(message = 'Turn cancelled.') {
    super(message);
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

export function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const reason = typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.';
  const error = new Error(reason);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted');
}
