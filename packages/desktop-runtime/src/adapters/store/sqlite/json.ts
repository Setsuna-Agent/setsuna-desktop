import { gunzipSync, gzipSync } from 'node:zlib';

const COMPRESSION_THRESHOLD = 4096;

/** SQLite TEXT remains readable by older imports; a BLOB contains gzip-compressed UTF-8 JSON. */
export function encodeSqliteJson(value: unknown): string | Uint8Array {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) < COMPRESSION_THRESHOLD) return json;
  const compressed = gzipSync(json, { level: 1 });
  return compressed.byteLength < Buffer.byteLength(json) ? compressed : json;
}

export function sqliteJsonText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return gunzipSync(value).toString('utf8');
  throw new Error('Invalid SQLite JSON value.');
}

export function decodeSqliteJson<T>(value: unknown): T {
  return JSON.parse(sqliteJsonText(value)) as T;
}
