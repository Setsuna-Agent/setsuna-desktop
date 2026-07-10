import path from 'node:path';

const MAX_RUNTIME_ID_CHARS = 192;
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Runtime IDs are opaque storage keys, never filesystem paths. Keep validation at
 * the storage boundary even when callers also validate decoded route params.
 */
export function assertSafeRuntimeId(value: string, label = 'Runtime id'): string {
  if (
    !value
    || value.length > MAX_RUNTIME_ID_CHARS
    || value === '.'
    || value === '..'
    || !SAFE_RUNTIME_ID.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

/** Resolve a generated storage filename and prove that it remains under root. */
export function resolveRuntimeStoragePath(root: string, fileName: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Runtime storage path escapes its root.');
  }
  return target;
}
