import type { RuntimeExtensionNetworkPolicy } from '@setsuna-desktop/contracts';

export type ExtensionNetworkFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ExtensionNetworkResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;
const MAX_HEADER_VALUE_CHARS = 8_192;
const METHODS = new Set(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']);
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Executes extension HTTP requests through the runtime proxy and an exact-origin allowlist. */
export class ExtensionNetworkCoordinator {
  constructor(private readonly fetchImpl: ExtensionNetworkFetch = globalThis.fetch) {}

  async request(
    value: unknown,
    policy: RuntimeExtensionNetworkPolicy,
    parentSignal?: AbortSignal,
  ): Promise<ExtensionNetworkResponse> {
    const input = requiredRecord(value, 'Extension network request must be an object.');
    const url = allowedUrl(input.url, policy);
    const method = requestMethod(input.method);
    const headers = requestHeaders(input.headers);
    const body = requestBody(input.body, method);
    const timeoutMs = boundedInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, 'timeoutMs');
    const maxResponseBytes = boundedInteger(
      input.maxResponseBytes,
      DEFAULT_RESPONSE_BYTES,
      1,
      MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal,
    });
    return {
      status: response.status,
      statusText: response.statusText.slice(0, 256),
      headers: responseHeaders(response.headers),
      bodyBase64: (await readBoundedBody(response, maxResponseBytes)).toString('base64'),
    };
  }
}

function allowedUrl(value: unknown, policy: RuntimeExtensionNetworkPolicy): URL {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Extension network URL is required.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Extension network URL must be an absolute HTTP(S) URL.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Extension network URL must be an absolute HTTP(S) URL without credentials.');
  }
  if (!policy.allowedOrigins.includes(url.origin)) {
    throw new Error(`Extension network origin is not allowed: ${url.origin}`);
  }
  return url;
}

function requestMethod(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'GET';
  if (typeof value !== 'string') throw new Error('Extension network method must be a string.');
  const method = value.trim().toUpperCase();
  if (!METHODS.has(method)) throw new Error(`Extension network method is not supported: ${method}`);
  return method;
}

function requestHeaders(value: unknown): Headers {
  if (value === undefined || value === null) return new Headers();
  const input = requiredRecord(value, 'Extension network headers must be an object.');
  if (Object.keys(input).length > 64) throw new Error('Extension network headers cannot exceed 64 entries.');
  const headers = new Headers();
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    if (!name || FORBIDDEN_REQUEST_HEADERS.has(name)) {
      throw new Error(`Extension network header is not allowed: ${rawName}`);
    }
    if (typeof rawValue !== 'string' || rawValue.length > MAX_HEADER_VALUE_CHARS) {
      throw new Error(`Extension network header ${rawName} must be a bounded string.`);
    }
    headers.set(name, rawValue);
  }
  return headers;
}

function requestBody(value: unknown, method: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (method === 'GET' || method === 'HEAD') throw new Error(`Extension network ${method} requests cannot include a body.`);
  if (typeof value !== 'string') throw new Error('Extension network body must be a string.');
  if (Buffer.byteLength(value) > MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Extension network request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }
  return value;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  let bytes = 0;
  let full = false;
  headers.forEach((value, name) => {
    if (full) return;
    const boundedValue = value.slice(0, MAX_HEADER_VALUE_CHARS);
    bytes += Buffer.byteLength(name) + Buffer.byteLength(boundedValue);
    if (bytes > MAX_RESPONSE_HEADER_BYTES) {
      full = true;
      return;
    }
    output[name] = boundedValue;
  });
  return output;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const announcedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > maxBytes) {
    throw new Error(`Extension network response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Extension network response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Extension network ${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
