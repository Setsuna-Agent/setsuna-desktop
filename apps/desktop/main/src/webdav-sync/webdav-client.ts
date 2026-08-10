import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NormalizedWebDavLocation } from './normalization.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_METADATA_BYTES = 10 * 1024 * 1024;
const MAX_PROPFIND_BYTES = 2 * 1024 * 1024;

type WebDavFetch = typeof globalThis.fetch;

export type WebDavListEntry = {
  name: string;
  collection: boolean;
};

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
    const response = await this.request([], {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, signal, true);
    if (response.status === 404) return;
    await assertWebDavStatus(response, [200, 207], '无法连接 WebDAV 服务器。');
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
    const response = await this.request(parts, {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, signal);
    if (response.status === 404) return false;
    await assertWebDavStatus(response, [200, 207], '无法读取 WebDAV 远端路径。');
    return true;
  }

  async ensureCollection(parts: readonly string[], signal?: AbortSignal): Promise<void> {
    const allParts = [...this.location.remoteRootSegments, ...parts];
    for (let index = 1; index <= allParts.length; index += 1) {
      const response = await this.requestAbsoluteParts(allParts.slice(0, index), {
        method: 'MKCOL',
      }, signal, true, true);
      if ([200, 201, 204, 405].includes(response.status)) continue;
      await assertWebDavStatus(response, [200, 201, 204, 405], '无法创建 WebDAV 远端目录。');
    }
  }

  async putBuffer(
    parts: readonly string[],
    data: Buffer,
    options: { ifNoneMatch?: boolean; contentType?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    const response = await this.request(parts, {
      method: 'PUT',
      headers: {
        'Content-Length': String(data.byteLength),
        'Content-Type': options.contentType ?? 'application/octet-stream',
        ...(options.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
      body: data,
    }, options.signal, true);
    await assertWebDavStatus(response, [200, 201, 204], options.ifNoneMatch && response.status === 412
      ? '远端备份仓库已存在。'
      : '无法写入 WebDAV 远端文件。');
  }

  async putFile(
    parts: readonly string[],
    filePath: string,
    options: { ifNoneMatch?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('待上传的备份对象不是普通文件。');
    const response = await this.request(parts, {
      method: 'PUT',
      headers: {
        'Content-Length': String(fileStat.size),
        'Content-Type': 'application/octet-stream',
        ...(options.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
      body: createReadStream(filePath) as unknown as RequestInit['body'],
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }, options.signal, true);
    await assertWebDavStatus(response, [200, 201, 204], options.ifNoneMatch && response.status === 412
      ? '远端备份对象已存在。'
      : '无法上传 WebDAV 备份对象。');
  }

  async getBuffer(
    parts: readonly string[],
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<Buffer> {
    const response = await this.request(parts, { method: 'GET' }, options.signal, true);
    await assertWebDavStatus(response, [200], '无法下载 WebDAV 远端文件。');
    const maxBytes = options.maxBytes ?? MAX_METADATA_BYTES;
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('WebDAV 远端元数据超过安全大小限制。');
    }
    return boundedResponseBuffer(response, maxBytes, 'WebDAV 远端元数据超过安全大小限制。');
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
    const response = await this.request(parts, { method: 'GET' }, options.signal, true);
    await assertWebDavStatus(response, [200], '无法下载 WebDAV 备份对象。');
    if (!response.body) throw new Error('WebDAV 服务器返回了空响应。');
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      throw new Error('WebDAV 备份对象超过清单声明的大小。');
    }
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
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
  }

  async list(parts: readonly string[], signal?: AbortSignal): Promise<WebDavListEntry[]> {
    const response = await this.request(parts, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: propertyRequestBody,
    }, signal, true);
    if (response.status === 404) return [];
    await assertWebDavStatus(response, [200, 207], '无法列出 WebDAV 远端目录。');
    const body = await boundedResponseText(response, MAX_PROPFIND_BYTES);
    return parseWebDavList(body, this.url(parts, true));
  }

  async delete(
    parts: readonly string[],
    signal?: AbortSignal,
    collection = true,
  ): Promise<void> {
    const response = await this.request(parts, { method: 'DELETE' }, signal, collection);
    await assertWebDavStatus(response, [200, 202, 204, 404], '无法删除过期的 WebDAV 备份。');
  }

  private request(
    parts: readonly string[],
    init: RequestInit,
    signal?: AbortSignal,
    collection = false,
  ): Promise<Response> {
    return this.requestUrl(this.url(parts, collection), init, signal);
  }

  private requestAbsoluteParts(
    parts: readonly string[],
    init: RequestInit,
    signal?: AbortSignal,
    collection = false,
    skipRemoteRoot = false,
  ): Promise<Response> {
    const url = skipRemoteRoot ? this.absoluteUrl(parts, collection) : this.url(parts, collection);
    return this.requestUrl(url, init, signal);
  }

  private async requestUrl(url: URL, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('WebDAV 请求超时。')), DEFAULT_TIMEOUT_MS);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          Authorization: this.authorization,
          ...init.headers,
        },
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error('同步操作已取消。');
      if (controller.signal.aborted) throw new Error('WebDAV 请求超时。', { cause: error });
      throw webDavTransportError(error);
    } finally {
      clearTimeout(timeout);
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

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('WebDAV 目录响应超过安全大小限制。');
  }
  return (await boundedResponseBuffer(
    response,
    maxBytes,
    'WebDAV 目录响应超过安全大小限制。',
  )).toString('utf8');
}

async function boundedResponseBuffer(
  response: Response,
  maxBytes: number,
  limitMessage: string,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel(limitMessage).catch(() => undefined);
        throw new Error(limitMessage);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
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
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
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
