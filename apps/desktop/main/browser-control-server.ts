import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { DesktopBrowserControlCommand, DesktopBrowserKeyModifier } from '@setsuna-desktop/contracts';
import type { BrowserControlExecutor } from './browser-control.js';

const maxRequestBytes = 64 * 1024;

export type BrowserControlConnection = {
  token: string;
  url: string;
};

/** Authenticated loopback bridge from the runtime child to Electron main. */
export class BrowserControlServer {
  private readonly server = http.createServer((request, response) => {
    void this.handleRequest(request, response);
  });
  private readonly token = randomBytes(32).toString('hex');
  private connection: BrowserControlConnection | null = null;

  constructor(private readonly executor: BrowserControlExecutor) {}

  async start(): Promise<BrowserControlConnection> {
    if (this.connection) return this.connection;
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Browser control server did not bind a TCP port.');
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
    if (request.method !== 'POST' || request.url !== '/v1/browser/command') {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    const abort = new AbortController();
    request.once('aborted', () => abort.abort(new Error('Browser control client disconnected.')));
    response.once('close', () => {
      if (!response.writableEnded) abort.abort(new Error('Browser control client disconnected.'));
    });
    try {
      const command = parseBrowserControlCommand(await readJsonBody(request));
      const result = await this.executor.execute(command, abort.signal);
      sendJson(response, 200, { result });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Browser control request failed.' });
      }
    }
  }
}

export function parseBrowserControlCommand(value: unknown): DesktopBrowserControlCommand {
  if (!value || typeof value !== 'object') throw new Error('Browser control command must be an object.');
  const input = value as Record<string, unknown>;
  const tabId = optionalString(input.tabId, 'tabId');
  switch (input.kind) {
    case 'open':
      return { kind: 'open', url: requiredString(input.url, 'url') };
    case 'tabs':
      return { kind: 'tabs' };
    case 'snapshot':
      return { kind: 'snapshot', maxElements: optionalNumber(input.maxElements, 'maxElements'), tabId };
    case 'screenshot':
      return { kind: 'screenshot', tabId };
    case 'click':
      return { kind: 'click', ref: requiredString(input.ref, 'ref'), tabId };
    case 'type':
      return {
        clear: optionalBoolean(input.clear, 'clear'),
        kind: 'type',
        ref: requiredString(input.ref, 'ref'),
        submit: optionalBoolean(input.submit, 'submit'),
        tabId,
        text: requiredString(input.text, 'text', true),
      };
    case 'scroll':
      return {
        deltaY: optionalNumber(input.deltaY, 'deltaY'),
        kind: 'scroll',
        ref: optionalString(input.ref, 'ref'),
        tabId,
      };
    case 'key':
      return {
        key: requiredString(input.key, 'key'),
        kind: 'key',
        modifiers: optionalStringArray(input.modifiers, 'modifiers'),
        repeat: optionalNumber(input.repeat, 'repeat'),
        tabId,
      };
    case 'navigate':
      return { kind: 'navigate', tabId, url: requiredString(input.url, 'url') };
    case 'wait':
      return {
        kind: 'wait',
        tabId,
        text: optionalString(input.text, 'text'),
        timeoutMs: optionalNumber(input.timeoutMs, 'timeoutMs'),
      };
    default:
      throw new Error('Unknown browser control command.');
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > maxRequestBytes) throw new Error('Browser control request is too large.');
  }
  if (!body) throw new Error('Browser control request body is empty.');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Browser control request body is not valid JSON.');
  }
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`Browser control ${field} must be a string.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Browser control ${field} must be a finite number.`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Browser control ${field} must be a boolean.`);
  return value;
}

function optionalStringArray(value: unknown, field: string): DesktopBrowserKeyModifier[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Browser control ${field} must be an array of strings.`);
  }
  const allowed = new Set<DesktopBrowserKeyModifier>(['Alt', 'Control', 'Meta', 'Shift']);
  return value.map((item) => {
    if (!allowed.has(item as DesktopBrowserKeyModifier)) {
      throw new Error(`Browser control ${field} contains an unsupported modifier.`);
    }
    return item as DesktopBrowserKeyModifier;
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
