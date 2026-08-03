type RuntimeTransportRequestOptions = {
  fetchImpl?: typeof fetch;
  label: string;
  retryDelayMs?: number;
  retryOnce?: boolean;
  runtimeState: () => 'running' | 'stopped' | 'stopping';
};

const DEFAULT_RUNTIME_GET_RETRY_DELAY_MS = 120;

/**
 * Retries one idempotent localhost request after a transport-level failure.
 *
 * HTTP responses, including 4xx/5xx, are returned directly and never retried here.
 * Mutating callers must leave retryOnce disabled because a missing response does not
 * prove that the runtime failed to apply the request.
 */
export async function fetchRuntimeResponse(
  url: string,
  init: RequestInit,
  options: RuntimeTransportRequestOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.retryOnce ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      console.warn(`[runtime] ${options.label} transport failed; retrying once`, error);
      await runtimeRequestDelay(
        Math.max(0, options.retryDelayMs ?? DEFAULT_RUNTIME_GET_RETRY_DELAY_MS),
      );
    }
  }

  throw runtimeTransportError(lastError, options.label, options.runtimeState(), maxAttempts);
}

function runtimeTransportError(
  cause: unknown,
  label: string,
  runtimeState: ReturnType<RuntimeTransportRequestOptions['runtimeState']>,
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
