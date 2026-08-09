import { errorMessage } from '../../shared/node-errors.js';

type MemoryBestEffortContext = {
  threadId?: string;
  turnId?: string;
};

export async function runMemoryBestEffort<T>(
  operation: string,
  fallback: T,
  task: () => Promise<T>,
  context: MemoryBestEffortContext = {},
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    reportMemoryBestEffortFailure(operation, error, context);
    return fallback;
  }
}

export function reportMemoryBestEffortFailure(
  operation: string,
  error: unknown,
  context: MemoryBestEffortContext = {},
): void {
  console.warn('[runtime:memory] best-effort operation failed', {
    operation,
    ...context,
    error: errorMessage(error).slice(0, 500),
  });
}
