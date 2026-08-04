export type RuntimeErrorUpdate = string | null | ((current: string | null) => string | null);

export type ScopedRuntimeError = {
  message: string;
  threadId: string | null;
};

/** Bind transient notices to the conversation that was active when the error occurred. */
export function updateScopedRuntimeError(
  current: ScopedRuntimeError | null,
  update: RuntimeErrorUpdate,
  threadId: string | null,
): ScopedRuntimeError | null {
  const currentMessage = runtimeErrorForThread(current, threadId);
  const message = typeof update === 'function' ? update(currentMessage) : update;
  return message === null ? null : { message, threadId };
}

export function runtimeErrorForThread(
  error: ScopedRuntimeError | null,
  threadId: string | null,
): string | null {
  return error?.threadId === threadId ? error.message : null;
}

/** Discard a notice after navigation so returning to its old thread cannot resurrect it. */
export function discardRuntimeErrorFromOtherThread(
  error: ScopedRuntimeError | null,
  threadId: string | null,
): ScopedRuntimeError | null {
  return error?.threadId === threadId ? error : null;
}
