import type { StoredThreadEvent } from '../events.js';

export type RuntimeApiToolResultPage = Readonly<{
  content: string;
  nextOffset: number | null;
  totalBytes: number;
}>;

export type RuntimeApiEventHistory = Readonly<{
  events: readonly StoredThreadEvent[];
  nextSinceSeq: number;
  hasMore: boolean;
  latestSeq: number;
}>;

/** Requests use the host's authenticated runtime transport, never a caller-supplied origin or token. */
export type RuntimeApiRequest = Readonly<{
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  body?: unknown;
}>;

export type RuntimeApiResponse = Readonly<{
  status: number;
  ok: boolean;
  /** JSON value, text, or { mimeType, base64 } for a binary resource. */
  data: unknown;
}>;

export type RuntimePluginUiRuntimeRequest = Readonly<{
  pluginId: string;
  contributionId: string;
  request: RuntimeApiRequest;
}>;

export const RUNTIME_API_MAX_BYTES = 8 * 1024 * 1024;

export function parseRuntimeApiRequest(value: unknown): RuntimeApiRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Runtime API request must be an object.');
  const input = value as Record<string, unknown>;
  if (typeof input.path !== 'string' || input.path.length > 8_192 || !input.path.startsWith('/v1/')) {
    throw new Error('Runtime API path must start with /v1/.');
  }
  const url = new URL(input.path, 'http://runtime.local');
  if (url.origin !== 'http://runtime.local' || !url.pathname.startsWith('/v1/')
    || url.hash || /[\\\s]/u.test(input.path)) throw new Error('Invalid runtime API path.');
  const method = input.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH'
    && method !== 'DELETE' && method !== 'HEAD') throw new Error('Invalid runtime API method.');
  if (input.body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new Error(`${method} requests cannot contain a body.`);
  }
  if (input.body !== undefined) {
    const json = JSON.stringify(input.body);
    if (json === undefined || new TextEncoder().encode(json).byteLength > RUNTIME_API_MAX_BYTES) {
      throw new Error('Runtime API request body is too large or not JSON.');
    }
  }
  return Object.freeze({ path: `${url.pathname}${url.search}`, method, ...(input.body === undefined ? {} : { body: input.body }) });
}

export function parseRuntimeApiResponse(value: unknown): RuntimeApiResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid runtime API response.');
  const response = value as Record<string, unknown>;
  if (!Number.isInteger(response.status) || (response.status as number) < 100 || (response.status as number) > 599
    || typeof response.ok !== 'boolean' || !('data' in response)) throw new Error('Invalid runtime API response.');
  return { status: response.status as number, ok: response.ok, data: response.data };
}
