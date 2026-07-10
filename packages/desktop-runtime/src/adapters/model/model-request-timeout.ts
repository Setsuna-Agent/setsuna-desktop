const DEFAULT_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export type ModelRequestTimeoutOptions = {
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
};

export async function* streamWithModelTimeout<T>(
  createStream: (signal: AbortSignal) => AsyncIterable<T>,
  parentSignal?: AbortSignal,
  options: ModelRequestTimeoutOptions = {},
): AsyncGenerator<T> {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const totalTimeoutMs = positiveTimeout(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const idleTimeoutMs = positiveTimeout(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  const deadline = Date.now() + totalTimeoutMs;
  const iterator = createStream(signal)[Symbol.asyncIterator]();
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError('Model request timed out.');
      const timeoutMs = Math.min(remaining, idleTimeoutMs);
      const reason = remaining <= idleTimeoutMs ? 'Model request timed out.' : 'Model stream became idle.';
      const result = await waitForIteratorResult(iterator.next(), signal, controller, timeoutMs, reason);
      if (result.done) return;
      yield result.value;
    }
  } finally {
    if (!controller.signal.aborted) controller.abort(new Error('Model stream closed.'));
    const returned = iterator.return?.();
    if (returned) void returned.catch(() => undefined);
  }
}

export async function runWithModelTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  options: ModelRequestTimeoutOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const timeoutMs = positiveTimeout(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  try {
    return await waitForPromise(operation(signal), signal, controller, timeoutMs, 'Model request timed out.');
  } finally {
    if (!controller.signal.aborted) controller.abort(new Error('Model request closed.'));
  }
}

function waitForIteratorResult<T>(
  pending: Promise<IteratorResult<T>>,
  signal: AbortSignal,
  controller: AbortController,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<IteratorResult<T>> {
  return waitForPromise(pending, signal, controller, timeoutMs, timeoutMessage);
}

function waitForPromise<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  controller: AbortController,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason ?? new Error('Model request aborted.')));
    const timer = setTimeout(() => {
      const error = timeoutError(timeoutMessage);
      controller.abort(error);
      finish(() => reject(error));
    }, timeoutMs);
    timer.unref();
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}
