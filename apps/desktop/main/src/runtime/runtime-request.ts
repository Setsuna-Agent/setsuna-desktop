import type { RuntimeProcess } from './runtime-process.js';

type RuntimeTransportRequestOptions = {
  label: string;
  retryDelayMs?: number;
  retryOnce?: boolean;
};

const DEFAULT_RUNTIME_GET_RETRY_DELAY_MS = 120;

/**
 * Retries one idempotent localhost request after a transport-level failure.
 *
 * The reader consumes the wire data. JSON parsing and domain errors belong to the caller.
 * Once an HTTP error status has arrived, its request is never retried.
 * Mutating callers must leave retryOnce disabled because a missing response does not
 * prove that the runtime failed to apply the request.
 */
export async function fetchRuntimeResponse<T>(
  runtime: RuntimeProcess,
  path: string,
  init: RequestInit,
  options: RuntimeTransportRequestOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const maxAttempts = options.retryOnce ? 2 : 1;

  for (let attempt = 1; ; attempt += 1) {
    // Startup failures belong to the lifecycle. Only a dispatched HTTP request can be retried.
    const url = await runtime.requestUrl(path, init.signal);
    let response: Response | undefined;
    try {
      throwIfRuntimeRequestCancelled(init.signal);
      response = await fetch(url, init);
      return await read(response);
    } catch (error) {
      // Retrying with the same aborted signal can never succeed. Renderer-driven
      // cancellation is an expected lifecycle outcome, not a transport failure.
      throwIfRuntimeRequestCancelled(init.signal, error);
      if (attempt >= maxAttempts || (response && !response.ok)) {
        throw runtimeTransportError(error, options.label, runtime.state, attempt);
      }
      console.warn(`[runtime] ${options.label} transport failed; retrying once`, error);
      await runtimeRequestDelay(
        Math.max(0, options.retryDelayMs ?? DEFAULT_RUNTIME_GET_RETRY_DELAY_MS),
      );
    }
  }
}

function throwIfRuntimeRequestCancelled(
  signal: AbortSignal | null | undefined,
  fallback?: unknown,
): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? fallback ?? new Error('Runtime request was cancelled.');
}

function runtimeTransportError(
  cause: unknown,
  label: string,
  runtimeState: RuntimeProcess['state'],
  attempts: number,
): Error {
  const causeCode = nestedErrorCode(cause);
  const causeMessage = cause instanceof Error ? cause.message.trim() : String(cause).trim();
  const details = [
    label,
    `runtime=${runtimeState}`,
    `attempts=${attempts}`,
    ...(causeCode ? [`cause=${causeCode}`] : []),
    ...(!causeCode && causeMessage ? [`reason=${causeMessage}`] : []),
  ].join('; ');
  return new Error(`Runtime request transport failed (${details}).`, { cause });
}

function nestedErrorCode(error: unknown): string | undefined {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object' || visited.has(current)) return undefined;
    visited.add(current);
    const record = current as { cause?: unknown; code?: unknown };
    if (typeof record.code === 'string' && record.code.trim()) return record.code.trim();
    current = record.cause;
  }
  return undefined;
}

function runtimeRequestDelay(delayMs: number): Promise<void> {
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
