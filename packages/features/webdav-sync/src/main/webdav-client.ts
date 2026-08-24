import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NormalizedWebDavLocation } from './normalization.js';

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const BUFFER_UPLOAD_CHUNK_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 10 * 1024 * 1024;
const MAX_PROPFIND_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type WebDavFetch = typeof globalThis.fetch;
type WebDavRequestInit = RequestInit & {
  bodyFactory?: () => RequestInit['body'];
  duplex?: 'half';
};
type WebDavResponseConsumer<T> = (
  response: Response,
  reportActivity: () => void,
) => Promise<T>;

export type WebDavListEntry = {
  name: string;
  collection: boolean;
};

export class WebDavResponseTooLargeError extends Error {}

export class WebDavClient {
  private readonly authorization: string;

  constructor(
    private readonly location: NormalizedWebDavLocation,
    credentials: { username: string; password: string },
    private readonly fetchImpl: WebDavFetch,
  ) {
    this.authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`;
  }

  async test(signal?: AbortSignal): Promise<void> {
    await this.request([], {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, async (response) => {
      if (response.status === 404) return;
      await assertWebDavStatus(response, [200, 207], '无法连接 WebDAV 服务器。');
    }, signal, true);
  }

  /** Verifies authentication plus read/write/delete access without saving config. */
  async testReadWrite(signal?: AbortSignal): Promise<void> {
    await this.test(signal);
    await this.ensureCollection([], signal);
    const objectName = `.setsuna-write-test-${randomUUID()}.tmp`;
    const payload = Buffer.from(randomUUID(), 'utf8');
    try {
      await this.putBuffer([objectName], payload, { ifNoneMatch: true, signal });
      const downloaded = await this.getBuffer([objectName], { maxBytes: 256, signal });
      if (!downloaded.equals(payload)) {
        throw new Error('WebDAV 读写测试返回了不一致的内容。');
      }
      await this.delete([objectName], signal, false);
    } finally {
      payload.fill(0);
      await this.delete([objectName], signal, false).catch(() => undefined);
    }
  }

  async exists(parts: readonly string[], signal?: AbortSignal): Promise<boolean> {
    return this.request(parts, {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, async (response) => {
      if (response.status === 404) return false;
      await assertWebDavStatus(response, [200, 207], '无法读取 WebDAV 远端路径。');
      return true;
    }, signal);
  }

  async ensureCollection(parts: readonly string[], signal?: AbortSignal): Promise<void> {
    const allParts = [...this.location.remoteRootSegments, ...parts];
    for (let index = 1; index <= allParts.length; index += 1) {
      await this.requestAbsoluteParts(allParts.slice(0, index), {
        method: 'MKCOL',
      }, async (response) => {
        await assertWebDavStatus(response, [200, 201, 204, 405], '无法创建 WebDAV 远端目录。');
      }, signal, true, true);
    }
  }

  async putBuffer(
    parts: readonly string[],
    data: Buffer,
    options: { ifNoneMatch?: boolean; contentType?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    await this.request(parts, {
      method: 'PUT',
      headers: {
        'Content-Length': String(data.byteLength),
        'Content-Type': options.contentType ?? 'application/octet-stream',
        ...(options.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
      bodyFactory: () => bufferUploadBody(data) as unknown as RequestInit['body'],
      duplex: 'half',
    }, async (response) => {
      await assertWebDavStatus(response, [200, 201, 204], options.ifNoneMatch && response.status === 412
        ? '远端备份仓库已存在。'
        : '无法写入 WebDAV 远端文件。');
    }, options.signal);
  }

  async putFile(
    parts: readonly string[],
    filePath: string,
    options: { ifNoneMatch?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('待上传的备份对象不是普通文件。');
    await this.request(parts, {
      method: 'PUT',
      headers: {
        'Content-Length': String(fileStat.size),
        'Content-Type': 'application/octet-stream',
        ...(options.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
      bodyFactory: () => createReadStream(filePath) as unknown as RequestInit['body'],
      duplex: 'half',
    }, async (response) => {
      await assertWebDavStatus(response, [200, 201, 204], options.ifNoneMatch && response.status === 412
        ? '远端备份对象已存在。'
        : '无法上传 WebDAV 备份对象。');
    }, options.signal);
  }

  async getBuffer(
    parts: readonly string[],
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<Buffer> {
    return this.request(parts, { method: 'GET' }, async (response, reportActivity) => {
      await assertWebDavStatus(response, [200], '无法下载 WebDAV 远端文件。');
      const maxBytes = options.maxBytes ?? MAX_METADATA_BYTES;
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new WebDavResponseTooLargeError('WebDAV 远端元数据超过安全大小限制。');
      }
      return boundedResponseBuffer(
        response,
        maxBytes,
        'WebDAV 远端元数据超过安全大小限制。',
        reportActivity,
      );
    }, options.signal);
  }

  async downloadFile(
    parts: readonly string[],
    destinationPath: string,
    options: {
      maxBytes: number;
      signal?: AbortSignal;
      onProgress?: (receivedBytes: number) => void;
    },
  ): Promise<void> {
    await this.request(parts, { method: 'GET' }, async (response, reportActivity) => {
      await assertWebDavStatus(response, [200], '无法下载 WebDAV 备份对象。');
      if (!response.body) throw new Error('WebDAV 服务器返回了空响应。');
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        throw new Error('WebDAV 备份对象超过清单声明的大小。');
      }
      let received = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          reportActivity();
          received += chunk.byteLength;
          if (received > options.maxBytes) {
            callback(new Error('WebDAV 备份对象超过清单声明的大小。'));
            return;
          }
          try {
            options.onProgress?.(received);
            callback(null, chunk);
          } catch (error) {
            callback(error instanceof Error ? error : new Error(String(error)));
          }
        },
      });
      await mkdir(path.dirname(destinationPath), { recursive: true });
      try {
        await pipeline(
          Readable.fromWeb(response.body as never),
          limiter,
          createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
          options.signal ? { signal: options.signal } : {},
        );
      } catch (error) {
        await rm(destinationPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }, options.signal);
  }

  async list(parts: readonly string[], signal?: AbortSignal): Promise<WebDavListEntry[]> {
    return this.request(parts, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, async (response, reportActivity) => {
      if (response.status === 404) return [];
      await assertWebDavStatus(response, [200, 207], '无法列出 WebDAV 远端目录。');
      const body = await boundedResponseText(response, MAX_PROPFIND_BYTES, reportActivity);
      return parseWebDavList(body, this.url(parts, true));
    }, signal, true);
  }

  async delete(
    parts: readonly string[],
    signal?: AbortSignal,
    collection = true,
  ): Promise<void> {
    await this.request(parts, { method: 'DELETE' }, async (response) => {
      await assertWebDavStatus(response, [200, 202, 204, 404], '无法删除过期的 WebDAV 备份。');
    }, signal, collection);
  }

  private request<T>(
    parts: readonly string[],
    init: WebDavRequestInit,
    consume: WebDavResponseConsumer<T>,
    signal?: AbortSignal,
    collection = false,
  ): Promise<T> {
    return this.requestUrl(this.url(parts, collection), init, consume, signal);
  }

  private requestAbsoluteParts<T>(
    parts: readonly string[],
    init: WebDavRequestInit,
    consume: WebDavResponseConsumer<T>,
    signal?: AbortSignal,
    collection = false,
    skipRemoteRoot = false,
  ): Promise<T> {
    const url = skipRemoteRoot ? this.absoluteUrl(parts, collection) : this.url(parts, collection);
    return this.requestUrl(url, init, consume, signal);
  }

  private async requestUrl<T>(
    url: URL,
    init: WebDavRequestInit,
    consume: WebDavResponseConsumer<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const reportActivity = () => {
      if (controller.signal.aborted) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(
        () => controller.abort(new Error('WebDAV 请求超时。')),
        DEFAULT_IDLE_TIMEOUT_MS,
      );
    };
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const { bodyFactory, ...fetchInit } = init;
    const method = (fetchInit.method ?? 'GET').toUpperCase();
    const authorizationScope = new URL(this.location.endpoint);
    let currentUrl = url;
    let includeAuthorization = true;
    let headersReceived = false;
    reportActivity();
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        headersReceived = false;
        const response = await this.fetchImpl(currentUrl, {
          ...fetchInit,
          body: activityTrackedRequestBody(
            bodyFactory ? bodyFactory() : fetchInit.body,
            reportActivity,
          ),
          redirect: 'manual',
          signal: controller.signal,
          headers: webDavRequestHeaders(
            fetchInit.headers,
            includeAuthorization ? this.authorization : undefined,
          ),
        });
        headersReceived = true;
        reportActivity();
        const redirect = webDavRedirect(response, currentUrl, authorizationScope, method);
        if (!redirect) return await consume(response, reportActivity);
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error('WebDAV 服务器返回了过多重定向。');
        }
        await response.body?.cancel().catch(() => undefined);
        currentUrl = redirect.url;
        includeAuthorization = redirect.includeAuthorization;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('同步操作已取消。');
      if (controller.signal.aborted) throw new Error('WebDAV 请求超时。', { cause: error });
      if (headersReceived) throw error;
      throw webDavTransportError(error);
    } finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  private url(parts: readonly string[], collection: boolean): URL {
    return this.absoluteUrl([...this.location.remoteRootSegments, ...parts], collection);
  }

  private absoluteUrl(parts: readonly string[], collection: boolean): URL {
    const url = new URL(this.location.endpoint);
    const endpointPath = url.pathname.replace(/\/+$/u, '');
    const encoded = parts.map((part) => encodeURIComponent(requireSafeRemoteSegment(part))).join('/');
    url.pathname = `${endpointPath}/${encoded}${collection ? '/' : ''}`.replace(/\/{2,}/gu, '/');
    return url;
  }
}

function webDavRequestHeaders(
  init: RequestInit['headers'],
  authorization: string | undefined,
): Headers {
  const headers = new Headers(init);
  if (!headers.has('accept')) headers.set('accept', '*/*');
  if (authorization) headers.set('authorization', authorization);
  else headers.delete('authorization');
  return headers;
}

function webDavRedirect(
  response: Response,
  requestUrl: URL,
  authorizationScope: URL,
  method: string,
): { url: URL; includeAuthorization: boolean } | undefined {
  if (![301, 302, 303, 307, 308].includes(response.status)) return undefined;
  const location = response.headers.get('location');
  if (!location) throw new Error('WebDAV 服务器返回了没有目标地址的重定向。');
  let url: URL;
  try {
    url = new URL(location, requestUrl);
  } catch {
    throw new Error('WebDAV 服务器返回了无效的重定向地址。');
  }
  if (url.username || url.password) {
    throw new Error('WebDAV 服务器返回的重定向地址包含凭据，Setsuna 已拒绝访问。');
  }
  const includeAuthorization = isWithinWebDavAuthorizationScope(url, authorizationScope);
  if (includeAuthorization) {
    if (response.status === 303 && method !== 'GET' && method !== 'HEAD') {
      throw new Error('WebDAV 服务器要求将写入请求重定向为读取请求，Setsuna 已拒绝访问。');
    }
    return { url, includeAuthorization: true };
  }
  if ((method !== 'GET' && method !== 'HEAD') || url.protocol !== 'https:') {
    throw new Error('WebDAV 服务器将请求重定向到认证范围之外，Setsuna 不会自动跟随。');
  }
  // Cloud WebDAV providers commonly return signed download URLs on another
  // origin. Following without Basic Auth preserves compatibility without
  // disclosing the WebDAV credentials to the download host.
  return { url, includeAuthorization: false };
}

function isWithinWebDavAuthorizationScope(url: URL, scope: URL): boolean {
  if (url.origin !== scope.origin) return false;
  const scopePath = scope.pathname.replace(/\/+$/u, '') || '/';
  if (scopePath === '/') return true;
  return url.pathname === scopePath || url.pathname.startsWith(`${scopePath}/`);
}

async function* bufferUploadBody(data: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < data.byteLength; offset += BUFFER_UPLOAD_CHUNK_BYTES) {
    yield data.subarray(offset, Math.min(offset + BUFFER_UPLOAD_CHUNK_BYTES, data.byteLength));
  }
}

const propertyRequestBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype /></d:prop></d:propfind>`;

async function assertWebDavStatus(
  response: Response,
  accepted: readonly number[],
  fallbackMessage: string,
): Promise<void> {
  if (accepted.includes(response.status)) return;
  if (response.status >= 300 && response.status < 400) {
    throw new Error('WebDAV 服务器返回了重定向；为避免泄露凭据，Setsuna 不会自动跟随。');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('WebDAV 身份验证失败，请检查用户名、密码和目录权限。');
  }
  if (response.status === 507) throw new Error('WebDAV 服务器空间不足。');
  throw new Error(`${fallbackMessage}（HTTP ${response.status}）`);
}

async function boundedResponseText(
  response: Response,
  maxBytes: number,
  reportActivity?: () => void,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('WebDAV 目录响应超过安全大小限制。');
  }
  return (await boundedResponseBuffer(
    response,
    maxBytes,
    'WebDAV 目录响应超过安全大小限制。',
    reportActivity,
  )).toString('utf8');
}

async function boundedResponseBuffer(
  response: Response,
  maxBytes: number,
  limitMessage: string,
  reportActivity?: () => void,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reportActivity?.();
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel(limitMessage).catch(() => undefined);
        throw new WebDavResponseTooLargeError(limitMessage);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
}

function activityTrackedRequestBody(
  body: RequestInit['body'],
  reportActivity: () => void,
): RequestInit['body'] {
  if (!isAsyncIterable(body)) return body;
  return trackAsyncIterableActivity(body, reportActivity) as unknown as RequestInit['body'];
}

async function* trackAsyncIterableActivity(
  body: AsyncIterable<unknown>,
  reportActivity: () => void,
): AsyncGenerator<unknown> {
  for await (const chunk of body) {
    reportActivity();
    yield chunk;
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value);
}

function parseWebDavList(xml: string, requestedUrl: URL): WebDavListEntry[] {
  const entries = new Map<string, WebDavListEntry>();
  const responsePattern = /<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?response\s*>/giu;
  for (const match of xml.matchAll(responsePattern)) {
    const block = match[1] ?? '';
    const hrefMatch = block.match(/<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href\s*>/iu);
    if (!hrefMatch) continue;
    const hrefText = decodeXmlText(hrefMatch[1] ?? '').trim();
    let href: URL;
    try {
      href = new URL(hrefText, requestedUrl);
    } catch {
      continue;
    }
    const requestedPath = decodePathname(requestedUrl.pathname).replace(/\/+$/u, '');
    const hrefPath = decodePathname(href.pathname).replace(/\/+$/u, '');
    if (!hrefPath.startsWith(`${requestedPath}/`) || hrefPath === requestedPath) continue;
    const remainder = hrefPath.slice(requestedPath.length + 1);
    if (!remainder || remainder.includes('/')) continue;
    const collection = /<(?:[A-Za-z_][\w.-]*:)?collection\b/iu.test(block);
    entries.set(remainder, { name: remainder, collection });
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function decodePathname(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function requireSafeRemoteSegment(value: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error('WebDAV 远端路径片段无效。');
  }
  return value;
}

function webDavTransportError(error: unknown): Error {
  const diagnostic = webDavTransportDiagnostic(error);
  return new Error(`无法访问 WebDAV 服务器：${diagnostic}`, { cause: error });
}

function webDavTransportDiagnostic(error: unknown): string {
  const values = errorChain(error);
  const codes = values.flatMap((value) => {
    if (!value || typeof value !== 'object' || !('code' in value)) return [];
    const code = String(value.code ?? '').toUpperCase();
    return code ? [code] : [];
  });
  const messages = values.flatMap((value) => {
    const message = value instanceof Error
      ? value.message
      : value && typeof value === 'object' && 'message' in value
        ? String(value.message ?? '')
        : '';
    return message ? [message.toUpperCase()] : [];
  });
  const haystack = [...codes, ...messages].join('\n');
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/u.test(haystack)) {
    return '无法解析服务器域名，请检查地址或 DNS。';
  }
  if (/CERT_|ERR_CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL/u.test(haystack)) {
    return 'TLS 证书校验失败，请检查证书有效期、域名和信任链。';
  }
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/u.test(haystack)) {
    return '服务器拒绝连接，请检查端口和 WebDAV 服务是否已启动。';
  }
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ERR_TIMED_OUT/u.test(haystack)) {
    return '连接超时，请检查网络和服务器地址。';
  }
  if (/PROXY|TUNNEL/u.test(haystack)) {
    return '代理连接失败，请检查“设置 → 网络代理”中的 WebDAV 同步路由。';
  }
  if (/ECONNRESET|UND_ERR_SOCKET|ERR_CONNECTION_(?:RESET|CLOSED)/u.test(haystack)) {
    return '连接被服务器或代理中断。';
  }
  if (/NET::ERR_FAILED|FAILED TO FETCH|FETCH FAILED/u.test(haystack)) {
    return '系统网络请求失败，请检查服务器证书及“设置 → 网络代理”中的 WebDAV 同步路由。';
  }
  const detail = values
    .map((value) => value instanceof Error ? value.message : '')
    .find((message) => message && message !== 'fetch failed' && message !== 'Failed to fetch');
  return detail
    ? `网络请求失败（${sanitizeTransportDetail(detail)}）。`
    : '网络请求失败，请检查服务器地址、证书和代理设置。';
}

function errorChain(error: unknown): unknown[] {
  const values: unknown[] = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 6; depth += 1) {
    values.push(current);
    current = current && typeof current === 'object' && 'cause' in current
      ? current.cause
      : undefined;
  }
  return values;
}

function sanitizeTransportDetail(value: string): string {
  return value
    .replace(/Basic\s+[A-Za-z0-9+/=_-]+/giu, 'Basic [redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 240);
}
