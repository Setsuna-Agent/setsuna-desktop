import {
  DESKTOP_NETWORK_PROXY_SCOPES,
  DESKTOP_SANDBOX_NETWORK_ENVIRONMENT_PATH,
  DESKTOP_SYSTEM_PROXY_FETCH_PATH,
  normalizeDesktopNetworkProxyRoute,
  type DesktopNetworkProxyState,
  type DesktopResolveNetworkProxyInput,
  type DesktopResolvedNetworkProxy,
  type DesktopSandboxNetworkEnvironment,
} from '@setsuna-desktop/contracts';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { CredentialVault } from '../security/credential-vault.js';
import { workspaceFilePreviewMimeType } from '../workspace/file-opening.js';
import {
  serveDesktopSystemProxyFetch,
  type DesktopSystemProxyFetch,
} from './native-bridge-system-fetch.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_FILE_PREVIEWS = 256;
const MAX_FILE_PREVIEW_CONTENT_BYTES = 64 * 1024 * 1024;

export type DesktopNativeBridgeConnection = {
  token: string;
  url: string;
};

type DesktopNativeBridgeOptions = {
  credentialVault: CredentialVault;
  deleteNetworkProxy(proxyServerId: string): Promise<DesktopNetworkProxyState>;
  openExternal(url: string): Promise<void>;
  resolveNetworkProxy(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy>;
  resolveSandboxNetworkEnvironment(): Promise<DesktopSandboxNetworkEnvironment>;
  systemProxyFetch: DesktopSystemProxyFetch;
  validateNetworkProxyReferences(proxyServerIds: readonly string[]): Promise<void>;
  /** Allows focused tests to exercise the byte-based eviction policy. */
  maxFilePreviewContentBytes?: number;
};

type DesktopFilePreview = {
  mimeType: string;
  name: string;
} & (
  | { content: Buffer; targetPath?: never }
  | { content?: never; targetPath: string; workspaceRoot?: string }
);

type DesktopFilePreviewRequest = {
  previewToken: string;
  resourcePath: string;
};

export type DesktopFilePreviewRegistration = {
  previewId: string;
  url: string;
};

/** 为仅供 runtime 使用的原生能力提供已认证的回环桥接。 */
export class DesktopNativeBridgeServer {
  private readonly server = http.createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly token = randomBytes(32).toString('hex');
  private readonly filePreviews = new Map<string, DesktopFilePreview>();
  private filePreviewContentBytes = 0;
  private connection: DesktopNativeBridgeConnection | null = null;

  constructor(private readonly options: DesktopNativeBridgeOptions) {}

  async start(): Promise<DesktopNativeBridgeConnection> {
    if (this.connection) return this.connection;
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Desktop native bridge did not bind a TCP port.');
    this.connection = { token: this.token, url: `http://127.0.0.1:${address.port}` };
    return this.connection;
  }

  async stop(): Promise<void> {
    this.filePreviews.clear();
    this.filePreviewContentBytes = 0;
    if (!this.server.listening) {
      this.connection = null;
      return;
    }
    this.server.close();
    await once(this.server, 'close');
    this.connection = null;
  }

  registerFilePreview(preview: DesktopFilePreview): string {
    return this.registerManagedFilePreview(preview).url;
  }

  registerManagedFilePreview(preview: DesktopFilePreview): DesktopFilePreviewRegistration {
    if (!this.connection) throw new Error('Desktop native bridge is not running.');
    const contentBytes = preview.content?.byteLength ?? 0;
    const contentBudget = this.options.maxFilePreviewContentBytes ?? MAX_FILE_PREVIEW_CONTENT_BYTES;
    if (contentBytes > contentBudget) {
      throw new Error('File preview exceeds the in-memory preview budget.');
    }
    const previewPath = filePreviewUrlPath(preview);
    const previewToken = randomBytes(24).toString('hex');
    this.filePreviews.set(previewToken, preview);
    this.filePreviewContentBytes += contentBytes;
    while (
      this.filePreviews.size > MAX_FILE_PREVIEWS
      || this.filePreviewContentBytes > contentBudget
    ) {
      const oldestToken = this.filePreviews.keys().next().value as string | undefined;
      if (!oldestToken) break;
      this.deleteFilePreview(oldestToken);
    }
    return {
      previewId: previewToken,
      url: `${this.connection.url}/v1/file-previews/${previewToken}/${previewPath}`,
    };
  }

  registerContentPreview(preview: { content: Buffer; mimeType: string; name: string }): DesktopFilePreviewRegistration {
    return this.registerManagedFilePreview(preview);
  }

  releaseFilePreview(previewId: string): boolean {
    return this.deleteFilePreview(previewId);
  }

  private deleteFilePreview(previewId: string): boolean {
    const preview = this.filePreviews.get(previewId);
    if (!preview) return false;
    this.filePreviews.delete(previewId);
    this.filePreviewContentBytes -= preview.content?.byteLength ?? 0;
    return true;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }
      const previewRequest = filePreviewRequest(request.url);
      if ((request.method === 'GET' || request.method === 'HEAD') && previewRequest) {
        await this.serveFilePreview(previewRequest, request, response);
        return;
      }
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        sendJson(response, 401, { error: 'Unauthorized.' });
        return;
      }
      if (request.method === 'GET' && request.url === '/v1/credentials/status') {
        sendJson(response, 200, await this.options.credentialVault.status());
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/credentials/get') {
        const { key } = credentialInput(await readJsonBody(request), false);
        sendJson(response, 200, { value: await this.options.credentialVault.get(key) });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/credentials/set') {
        const { key, value } = credentialInput(await readJsonBody(request), true);
        await this.options.credentialVault.set(key, value);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/credentials/delete') {
        const { key } = credentialInput(await readJsonBody(request), false);
        await this.options.credentialVault.delete(key);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/external/open') {
        const body = recordInput(await readJsonBody(request));
        const url = externalUrl(body.url);
        await this.options.openExternal(url);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/network-proxy/resolve') {
        const input = networkProxyInput(await readJsonBody(request));
        sendJson(response, 200, await this.options.resolveNetworkProxy(input));
        return;
      }
      if (request.method === 'GET' && request.url === DESKTOP_SANDBOX_NETWORK_ENVIRONMENT_PATH) {
        sendJson(response, 200, await this.options.resolveSandboxNetworkEnvironment());
        return;
      }
      if (request.method === 'POST' && request.url === DESKTOP_SYSTEM_PROXY_FETCH_PATH) {
        await serveDesktopSystemProxyFetch(request, response, this.options.systemProxyFetch);
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/network-proxy/validate-references') {
        const proxyServerIds = networkProxyReferenceInput(await readJsonBody(request));
        await this.options.validateNetworkProxyReferences(proxyServerIds);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/network-proxy/delete') {
        const proxyServerId = networkProxyServerIdInput(await readJsonBody(request));
        sendJson(response, 200, await this.options.deleteNetworkProxy(proxyServerId));
        return;
      }
      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Desktop native bridge request failed.' });
    }
  }

  private async serveFilePreview(
    previewRequest: DesktopFilePreviewRequest,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const preview = this.filePreviews.get(previewRequest.previewToken);
    if (!preview) {
      sendJson(response, 404, { error: 'File preview is unavailable.' });
      return;
    }
    const resource = await resolveFilePreviewResource(preview, previewRequest.resourcePath);
    if (!resource) {
      sendJson(response, 404, { error: 'File preview target is unavailable.' });
      return;
    }
    const fileSize = resource.content?.byteLength ?? await previewFileSize(resource.targetPath);
    if (fileSize === null) {
      sendJson(response, 404, { error: 'File preview target is unavailable.' });
      return;
    }
    const range = parseByteRange(request.headers.range, fileSize);
    if (range === 'invalid') {
      response.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      response.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileSize - 1);
    const contentLength = fileSize === 0 ? 0 : end - start + 1;
    response.writeHead(range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(resource.name)}`,
      'Content-Length': contentLength,
      'Content-Type': resource.mimeType,
      'X-Content-Type-Options': 'nosniff',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fileSize}` } : {}),
    });
    if (request.method === 'HEAD' || fileSize === 0) {
      response.end();
      return;
    }
    if (resource.content) {
      response.end(resource.content.subarray(start, end + 1));
      return;
    }
    const stream = createReadStream(resource.targetPath, { start, end });
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}

async function previewFileSize(targetPath: string | undefined): Promise<number | null> {
  if (!targetPath) return null;
  const fileStats = await stat(targetPath).catch(() => null);
  return fileStats?.isFile() ? fileStats.size : null;
}

function filePreviewRequest(requestUrl: string | undefined): DesktopFilePreviewRequest | null {
  if (!requestUrl) return null;
  try {
    const match = new URL(requestUrl, 'http://127.0.0.1').pathname.match(/^\/v1\/file-previews\/([a-f0-9]{48})\/(.+)$/u);
    const previewToken = match?.[1];
    const encodedResourcePath = match?.[2];
    if (!previewToken || !encodedResourcePath) return null;
    return {
      previewToken,
      resourcePath: encodedResourcePath
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join(path.sep),
    };
  } catch {
    return null;
  }
}

function filePreviewUrlPath(preview: DesktopFilePreview): string {
  if (preview.content !== undefined || !preview.workspaceRoot) {
    return encodeURIComponent(preview.name);
  }
  const relativePath = path.relative(preview.workspaceRoot, preview.targetPath);
  if (!isRelativePathInside(relativePath)) {
    throw new Error('File preview target must stay inside the workspace.');
  }
  return relativePath.split(path.sep).map((segment) => encodeURIComponent(segment)).join('/');
}

async function resolveFilePreviewResource(
  preview: DesktopFilePreview,
  resourcePath: string,
): Promise<DesktopFilePreview | null> {
  if (preview.content !== undefined) {
    return resourcePath === preview.name ? preview : null;
  }
  if (!preview.workspaceRoot) {
    return resourcePath === preview.name ? preview : null;
  }
  if (path.isAbsolute(resourcePath)) return null;
  try {
    const canonicalRoot = await realpath(preview.workspaceRoot);
    const canonicalTarget = await realpath(path.resolve(canonicalRoot, resourcePath));
    const relativePath = path.relative(canonicalRoot, canonicalTarget);
    if (!isRelativePathInside(relativePath)) return null;
    const targetStats = await stat(canonicalTarget);
    if (!targetStats.isFile()) return null;
    return {
      mimeType: workspaceFilePreviewMimeType(canonicalTarget),
      name: path.basename(canonicalTarget),
      targetPath: canonicalTarget,
      workspaceRoot: canonicalRoot,
    };
  } catch {
    return null;
  }
}

function isRelativePathInside(relativePath: string): boolean {
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function parseByteRange(value: string | undefined, size: number): { end: number; start: number } | 'invalid' | null {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || size <= 0) return 'invalid';
  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return 'invalid';
  const start = startValue ? Number(startValue) : Math.max(0, size - Number(endValue));
  const end = endValue && startValue ? Number(endValue) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function credentialInput(value: unknown, requiresValue: boolean): { key: string; value: string } {
  const input = recordInput(value);
  const key = typeof input.key === 'string' ? input.key : '';
  const credentialValue = typeof input.value === 'string' ? input.value : '';
  if (!key.trim()) throw new Error('Credential key is required.');
  if (key.trim().toLocaleLowerCase().startsWith('network-proxy.')) {
    throw new Error('Credential key is reserved for the desktop network proxy service.');
  }
  if (requiresValue && typeof input.value !== 'string') throw new Error('Credential value is required.');
  return { key, value: credentialValue };
}

function externalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('External URL is required.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only HTTP(S) external URLs are allowed.');
  }
  return url.toString();
}

function networkProxyInput(value: unknown): DesktopResolveNetworkProxyInput {
  const input = recordInput(value);
  const scope = DESKTOP_NETWORK_PROXY_SCOPES.find((candidate) => candidate === input.scope);
  if (!scope) throw new Error('Network proxy scope is invalid.');
  const override = input.override === undefined
    ? undefined
    : normalizeDesktopNetworkProxyRoute(input.override);
  if (input.override !== undefined && !override) throw new Error('Network proxy override is invalid.');
  return {
    scope,
    ...(override ? { override } : {}),
  };
}

function networkProxyReferenceInput(value: unknown): string[] {
  const input = recordInput(value);
  if (!Array.isArray(input.proxyServerIds) || input.proxyServerIds.length > 256) {
    throw new Error('Network proxy references are invalid.');
  }
  const proxyServerIds = input.proxyServerIds.map((proxyServerId) => {
    if (typeof proxyServerId !== 'string' || !proxyServerId.trim()) {
      throw new Error('Network proxy reference is invalid.');
    }
    return proxyServerId.trim();
  });
  return [...new Set(proxyServerIds)];
}

function networkProxyServerIdInput(value: unknown): string {
  const input = recordInput(value);
  if (typeof input.proxyServerId !== 'string' || !input.proxyServerId.trim()) {
    throw new Error('Network proxy server ID is invalid.');
  }
  return input.proxyServerId.trim();
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('Desktop native bridge request is too large.');
  }
  if (!body) throw new Error('Desktop native bridge request body is empty.');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Desktop native bridge request body is not valid JSON.');
  }
}

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be an object.');
  return value as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
