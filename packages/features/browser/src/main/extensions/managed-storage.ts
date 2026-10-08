import type { Extension } from 'electron';

/** No administrator policies are configured; expose Chrome's empty, read-only managed area. */
export function managedStorageCall(extension: Extension, method: string, args: unknown[]): unknown {
  if (!extension.manifest.permissions?.includes('storage')) throw new Error('storage permission required.');
  if (method === 'getKeys') return [];
  if (method === 'getBytesInUse') return 0;
  if (method !== 'get') throw new Error('Managed storage is read-only.');
  const keys = args[0];
  if (keys === undefined || keys === null || typeof keys === 'string' || Array.isArray(keys) && keys.every(key => typeof key === 'string')) return {};
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid storage keys.');
  return structuredClone(keys);
}
