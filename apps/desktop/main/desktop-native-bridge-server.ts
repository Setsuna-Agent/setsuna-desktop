import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { CredentialVault } from './desktop-credential-vault.js';

const MAX_REQUEST_BYTES = 1024 * 1024;

export type DesktopNativeBridgeConnection = {
  token: string;
  url: string;
};

type DesktopNativeBridgeOptions = {
  credentialVault: CredentialVault;
  openExternal(url: string): Promise<void>;
};

/** Authenticated loopback bridge for runtime-only native capabilities. */
export class DesktopNativeBridgeServer {
  private readonly server = http.createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly token = randomBytes(32).toString('hex');
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
    if (!this.server.listening) {
      this.connection = null;
      return;
    }
    this.server.close();
    await once(this.server, 'close');
    this.connection = null;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    try {
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
