import type { AssistantPeerRef } from '../../contracts/index.js';

export const QQ_API_BASE_URL = 'https://api.sgroup.qq.com';
export const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

/** Refresh shortly before expiry so long requests never start with a token about to lapse. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type QqFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class QqApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
    this.name = 'QqApiError';
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function apiError(response: Response, body: Record<string, unknown>, fallback: string): QqApiError {
  const code = typeof body.code === 'number' ? body.code : typeof body.err_code === 'number' ? body.err_code : undefined;
  const detail = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : fallback;
  return new QqApiError(code === undefined ? detail : `${detail} (${code})`, response.status, code);
}

/** Official QQ bot OpenAPI: app access token, gateway discovery and text/Markdown messages. */
export class QqApiClient {
  private token: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly options: {
    appId: string;
    secret: string;
    fetch: QqFetch;
    now(): Date;
    baseUrl?: string;
    tokenUrl?: string;
  }) {}

  accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.options.now().getTime()) return Promise.resolve(this.token.value);
    // Concurrent senders share one refresh instead of racing for new tokens.
    this.refreshing ??= this.fetchToken().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async gatewayUrl(): Promise<string> {
    const body = await this.request('GET', '/gateway');
    if (typeof body.url !== 'string' || !/^wss?:\/\//u.test(body.url)) throw new QqApiError('QQ gateway did not return a WebSocket URL.', 502);
    return body.url;
  }

  async sendMessage(peer: AssistantPeerRef, message: { content: string; markdownEnabled: boolean; replyTo?: { messageId: string; seq: number } }): Promise<void> {
    const target = peer.kind === 'c2c' ? `/v2/users/${encodeURIComponent(peer.openid)}/messages` : `/v2/groups/${encodeURIComponent(peer.openid)}/messages`;
    await this.request('POST', target, {
      ...(message.markdownEnabled
        ? { msg_type: 2, markdown: { content: message.content } }
        : { msg_type: 0, content: message.content }),
      ...(message.replyTo ? { msg_id: message.replyTo.messageId, msg_seq: message.replyTo.seq } : {}),
    });
  }

  private async fetchToken(): Promise<string> {
    const response = await this.options.fetch(this.options.tokenUrl ?? QQ_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.options.appId, clientSecret: this.options.secret }),
    });
    const body = await readJson(response);
    if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
      throw apiError(response, body, 'QQ 鉴权失败，请检查 AppID 与 AppSecret。');
    }
    const expiresInSeconds = Number(body.expires_in);
    this.token = {
      value: body.access_token,
      expiresAt: this.options.now().getTime() + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 7_200) * 1_000,
    };
    return this.token.value;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    const response = await this.options.fetch(`${this.options.baseUrl ?? QQ_API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await readJson(response);
    // A revoked token is refreshed on the next call instead of failing until expiry.
    if (response.status === 401) this.token = null;
    if (!response.ok) throw apiError(response, payload, `QQ 接口请求失败（HTTP ${response.status}）。`);
    return payload;
  }
}
