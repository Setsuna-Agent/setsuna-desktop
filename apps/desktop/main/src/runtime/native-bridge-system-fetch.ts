import {
  DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER,
  DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES,
  DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES,
  type DesktopSystemProxyFetchRequest,
} from '@setsuna-desktop/contracts';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_REQUEST_BODY_BYTES = 128 * 1024 * 1024;
const MAX_REQUEST_FRAME_BYTES = MAX_REQUEST_BODY_BYTES
  + DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES
  + DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES;
const ALLOWED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
const FORWARDED_RESPONSE_HEADERS_DENYLIST = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER,
]);

export type DesktopSystemProxyFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Streams a runtime request through Electron's system-aware Chromium network stack. */
export async function serveDesktopSystemProxyFetch(
  request: IncomingMessage,
  response: ServerResponse,
  fetchWithSystemProxy: DesktopSystemProxyFetch,
): Promise<void> {
  const abortController = new AbortController();
  const abort = () => abortController.abort(new Error('Desktop system proxy request was cancelled.'));
  request.once('aborted', abort);
  response.once('close', abortIfIncomplete);

  try {
    const { body, ...metadata } = systemProxyFetchRequest(await readRequestFrame(request));
    const upstream = await fetchWithSystemProxy(metadata.url, {
      method: metadata.method,
      headers: metadata.headers,
      ...(body?.length ? { body } : {}),
      signal: abortController.signal,
    });
    response.writeHead(upstream.status, forwardedResponseHeaders(upstream.headers));
    if (!upstream.body || metadata.method === 'HEAD') {
      response.end();
      return;
    }
    for await (const chunk of upstream.body) {
      if (!response.write(Buffer.from(chunk))) {
        // A closed response never emits drain. Bind the wait to the same abort
        // signal so a disconnected runtime cannot strand this bridge handler.
        await once(response, 'drain', { signal: abortController.signal });
      }
    }
    response.end();
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    response.writeHead(502, {
      'Content-Type': 'text/plain; charset=utf-8',
      [DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER]: '1',
    });
    response.end(error instanceof Error ? error.message : 'Desktop system proxy request failed.');
  } finally {
    request.off('aborted', abort);
    response.off('close', abortIfIncomplete);
  }

  function abortIfIncomplete(): void {
    if (!response.writableEnded) abort();
  }
}

function systemProxyFetchRequest(frame: Buffer): DesktopSystemProxyFetchRequest & { body: Buffer } {
  if (frame.length < DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES) {
    throw new Error('Desktop system proxy request metadata is missing.');
  }
  const metadataLength = frame.readUInt32BE(0);
  if (
    metadataLength > DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES
    || metadataLength > frame.length - DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES
  ) {
    throw new Error('Desktop system proxy request metadata is invalid.');
  }
  const metadataEnd = DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES + metadataLength;
  let parsed: unknown;
  try {
    const metadataBytes = frame.subarray(DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES, metadataEnd);
    parsed = JSON.parse(metadataBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Desktop system proxy request metadata is invalid.');
  }
  if (!isRecord(parsed) || typeof parsed.method !== 'string' || typeof parsed.url !== 'string') {
    throw new Error('Desktop system proxy request metadata is invalid.');
  }
  const method = parsed.method.toLocaleUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error(`Desktop system proxy method is not allowed: ${method}`);
  const url = new URL(parsed.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Desktop system proxy requests must use HTTP(S).');
  }
  if (!Array.isArray(parsed.headers) || parsed.headers.length > 256) {
    throw new Error('Desktop system proxy request headers are invalid.');
  }
  const headers = parsed.headers.map((entry): [string, string] => {
    if (!Array.isArray(entry) || entry.length !== 2 || entry.some((item) => typeof item !== 'string')) {
      throw new Error('Desktop system proxy request headers are invalid.');
    }
    return [entry[0] as string, entry[1] as string];
  });
  const body = frame.subarray(metadataEnd);
  if (body.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error('Desktop system proxy request body is too large.');
  }
  if (!requestBodyAllowed(method) && body.length) {
    throw new Error(`Desktop system proxy method does not allow a request body: ${method}`);
  }
  // Constructing Headers rejects invalid names and values before Chromium sees them.
  return { body, headers: headerEntries(new Headers(headers)), method, url: url.toString() };
}

async function readRequestFrame(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_FRAME_BYTES) throw new Error('Desktop system proxy request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function forwardedResponseHeaders(headers: Headers): Array<[string, string]> {
  return headerEntries(headers)
    .filter(([name]) => !FORWARDED_RESPONSE_HEADERS_DENYLIST.has(name.toLocaleLowerCase()));
}

function headerEntries(headers: Headers): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, name) => entries.push([name, value]));
  return entries;
}

function requestBodyAllowed(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
