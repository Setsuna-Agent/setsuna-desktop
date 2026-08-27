import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';

const CALLBACK_PATH = '/oauth/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type McpOAuthCallback = {
  code: string;
  state: string;
};

/** 带状态校验及有限生命周期的一次性回环回调监听器。 */
export class McpOAuthCallbackServer {
  readonly state = randomBytes(32).toString('base64url');
  private readonly server = http.createServer((request, response) => this.handleRequest(request, response));
  private callbackPromise: Promise<McpOAuthCallback> | null = null;
  private resolveCallback: ((value: McpOAuthCallback) => void) | null = null;
  private rejectCallback: ((error: Error) => void) | null = null;
  private redirectUrlValue: string | null = null;

  async start(): Promise<string> {
    if (this.redirectUrlValue) return this.redirectUrlValue;
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('MCP OAuth callback server did not bind a TCP port.');
    this.redirectUrlValue = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
    return this.redirectUrlValue;
  }

  wait(signal?: AbortSignal, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<McpOAuthCallback> {
    if (!this.callbackPromise) {
      this.callbackPromise = new Promise<McpOAuthCallback>((resolve, reject) => {
        this.resolveCallback = resolve;
        this.rejectCallback = reject;
      });
    }
    return waitForCallback(this.callbackPromise, signal, timeoutMs);
  }

  async close(): Promise<void> {
    this.rejectCallback?.(new Error('MCP OAuth callback listener closed.'));
    this.rejectCallback = null;
    this.resolveCallback = null;
    if (!this.server.listening) return;
    this.server.close();
    await once(this.server, 'close');
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
      return;
    }

    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    const oauthError = url.searchParams.get('error');
    if (!state || !safeStateEqual(state, this.state)) {
      this.rejectCallback?.(new Error('MCP OAuth callback state did not match.'));
      this.respond(response, 400, 'Authorization failed', 'The callback state was invalid. You can close this window.');
      return;
    }
    if (oauthError) {
      const description = url.searchParams.get('error_description') ?? oauthError;
      this.rejectCallback?.(new Error(`MCP OAuth authorization failed: ${description}`));
      this.respond(response, 400, 'Authorization failed', 'The authorization server rejected the request. You can close this window.');
      return;
    }
    if (!code) {
      this.rejectCallback?.(new Error('MCP OAuth callback did not include an authorization code.'));
      this.respond(response, 400, 'Authorization failed', 'No authorization code was returned. You can close this window.');
      return;
    }

    this.resolveCallback?.({ code, state });
    this.resolveCallback = null;
    this.rejectCallback = null;
    this.respond(response, 200, 'Authorization complete', 'Setsuna Desktop received the authorization. You can close this window.');
  }

  private respond(response: http.ServerResponse, status: number, title: string, message: string): void {
    response.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;margin:48px;line-height:1.5;color:#202124}main{max-width:560px}</style><main><h1>${title}</h1><p>${message}</p></main>`);
  }
}

function safeStateEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function waitForCallback<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error('MCP OAuth authorization timed out.'))), timeoutMs);
    timeout.unref?.();
    const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    const finish = (complete: () => void) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      complete();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
