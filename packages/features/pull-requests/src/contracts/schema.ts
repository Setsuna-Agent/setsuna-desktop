import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

type Read<T> = (value: unknown) => T;

/** Small, feature-local DTO readers keep both sides of the transport fail-closed. */
export function object<S extends Record<string, Read<unknown>>>(shape: S): Read<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a PR object.');
    const input = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, read] of Object.entries(shape)) result[key] = read(input[key]);
    return result as { [K in keyof S]: ReturnType<S[K]> };
  };
}

export function text(max = 100_000, pattern?: RegExp): Read<string> {
  return (value) => {
    if (typeof value !== 'string' || value.length > max || (pattern && !pattern.test(value))) throw new Error('Invalid PR text.');
    return value;
  };
}
export const integer: Read<number> = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid PR count.');
  return value;
};
export const boolean: Read<boolean> = (value) => {
  if (typeof value !== 'boolean') throw new Error('Invalid PR flag.');
  return value;
};
export const nullable = <T>(read: Read<T>): Read<T | null> => (value) => value === null ? null : read(value);
export const array = <T>(read: Read<T>): Read<T[]> => (value) => {
  if (!Array.isArray(value)) throw new Error('Invalid PR list.');
  return value.map(read);
};
export function choice<const T extends readonly string[]>(values: T): Read<T[number]> {
  return (value) => {
    if (typeof value !== 'string' || !values.includes(value)) throw new Error('Invalid PR option.');
    return value;
  };
}
export const codec = defineRuntimeCodec;
export const repositoryId: Read<string> = (value) => {
  const name = text(250, /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u)(value);
  if (name.split('/').some((part) => part === '.' || part === '..')) throw new Error('Invalid GitHub repository.');
  return name;
};
export const oid = text(64, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
export const nodeId = text(256, /^[a-zA-Z0-9_+/=-]+$/u);
export const cursor = nullable(text(1024));
export const httpsUrl: Read<string> = (value) => {
  const source = text(8192)(value);
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid GitHub link.');
  return source;
};
export const positiveInteger: Read<number> = (value) => {
  const result = integer(value);
  if (result < 1) throw new Error('Expected a positive PR number.');
  return result;
};
export const filePath = text(4096, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/u);
