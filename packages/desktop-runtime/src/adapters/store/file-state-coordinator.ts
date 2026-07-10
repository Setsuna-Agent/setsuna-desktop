import path from 'node:path';

const fileStateQueues = new Map<string, Promise<void>>();

/**
 * Serialize read-modify-write operations for one persisted state file.
 *
 * This is intentionally shared by store instances because tests and future
 * runtime composition may create more than one adapter for the same path.
 */
export async function withFileStateUpdate<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const previous = fileStateQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  fileStateQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (fileStateQueues.get(key) === queued) fileStateQueues.delete(key);
  }
}
