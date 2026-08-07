import {
  DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER,
  DESKTOP_SYSTEM_PROXY_FETCH_REQUEST_HEADER,
  type DesktopSystemProxyFetchRequest,
} from '@setsuna-desktop/contracts';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_REQUEST_BODY_BYTES = 128 * 1024 * 1024;
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
    const metadata = systemProxyFetchRequest(request.headers[DESKTOP_SYSTEM_PROXY_FETCH_REQUEST_HEADER]);
    const body = requestBodyAllowed(metadata.method)
      ? await readRequestBody(request)
      : undefined;
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
      if (!response.write(Buffer.from(chunk))) await once(response, 'drain');
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

function systemProxyFetchRequest(value: string | string[] | undefined): DesktopSystemProxyFetchRequest {
  if (typeof value !== 'string') throw new Error('Desktop system proxy request metadata is missing.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
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
  // Constructing Headers rejects invalid names and values before Chromium sees them.
  return { headers: headerEntries(new Headers(headers)), method, url: url.toString() };
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('Desktop system proxy request body is too large.');
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
