import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { CredentialVault } from '../security/credential-vault.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_FILE_PREVIEWS = 256;

export type DesktopNativeBridgeConnection = {
  token: string;
  url: string;
};

type DesktopNativeBridgeOptions = {
  credentialVault: CredentialVault;
  openExternal(url: string): Promise<void>;
};

type DesktopFilePreview = {
  mimeType: string;
  name: string;
  targetPath: string;
};

/** 为仅供 runtime 使用的原生能力提供已认证的回环桥接。 */
export class DesktopNativeBridgeServer {
  private readonly server = http.createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly token = randomBytes(32).toString('hex');
  private readonly filePreviews = new Map<string, DesktopFilePreview>();
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
    if (!this.server.listening) {
      this.connection = null;
      return;
    }
    this.server.close();
    await once(this.server, 'close');
    this.connection = null;
  }

  registerFilePreview(preview: DesktopFilePreview): string {
    if (!this.connection) throw new Error('Desktop native bridge is not running.');
    const previewToken = randomBytes(24).toString('hex');
    this.filePreviews.set(previewToken, preview);
    while (this.filePreviews.size > MAX_FILE_PREVIEWS) {
      const oldestToken = this.filePreviews.keys().next().value as string | undefined;
      if (!oldestToken) break;
      this.filePreviews.delete(oldestToken);
    }
    return `${this.connection.url}/v1/file-previews/${previewToken}/${encodeURIComponent(preview.name)}`;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }
      const previewToken = filePreviewToken(request.url);
      if ((request.method === 'GET' || request.method === 'HEAD') && previewToken) {
        await this.serveFilePreview(previewToken, request, response);
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
      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Desktop native bridge request failed.' });
    }
  }

  private async serveFilePreview(
    previewToken: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const preview = this.filePreviews.get(previewToken);
    if (!preview) {
      sendJson(response, 404, { error: 'File preview is unavailable.' });
      return;
    }
    const fileStats = await stat(preview.targetPath);
    if (!fileStats.isFile()) {
      sendJson(response, 404, { error: 'File preview target is unavailable.' });
      return;
    }
    const range = parseByteRange(request.headers.range, fileStats.size);
    if (range === 'invalid') {
      response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` });
      response.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileStats.size - 1);
    const contentLength = fileStats.size === 0 ? 0 : end - start + 1;
    response.writeHead(range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
      'Content-Length': contentLength,
      'Content-Type': preview.mimeType,
      'X-Content-Type-Options': 'nosniff',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fileStats.size}` } : {}),
    });
    if (request.method === 'HEAD' || fileStats.size === 0) {
      response.end();
      return;
    }
    const stream = createReadStream(preview.targetPath, { start, end });
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}

function filePreviewToken(requestUrl: string | undefined): string | null {
  if (!requestUrl) return null;
  const match = new URL(requestUrl, 'http://127.0.0.1').pathname.match(/^\/v1\/file-previews\/([a-f0-9]{48})(?:\/|$)/u);
  return match?.[1] ?? null;
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
