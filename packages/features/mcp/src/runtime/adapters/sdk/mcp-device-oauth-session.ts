import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RuntimeMcpDeviceAuthorization, RuntimeMcpServerInput } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import type { McpAuthStatusResult, McpCredentialStore, McpLoginOptions } from '../../../contracts/control.js';
import { performDeviceOAuth, refreshDeviceOAuth, type DeviceOAuthFetch } from './mcp-device-oauth-flow.js';
import { mcpDeviceOAuthProvider } from './mcp-device-oauth-provider.js';

type StoredTokens = { savedAt: number; tokens: OAuthTokens };
type PendingLogin = { identity: string; controller: AbortController; promise: Promise<void>; challenge?: RuntimeMcpDeviceAuthorization };
type PendingRefresh = { controller: AbortController; promise: Promise<StoredTokens> };

/** Owns device login/polling and vault-backed tokens. All URLs come from registered host providers. */
export class McpDeviceOAuthSession {
  private readonly logins = new Map<string, PendingLogin>();
  private readonly refreshes = new Map<string, PendingRefresh>();
  private readonly errors = new Map<string, string>();
  private readonly logoutVersions = new Map<string, number>();

  constructor(
    private readonly credentials: McpCredentialStore,
    private readonly fetch: DeviceOAuthFetch,
    private readonly now: () => number,
  ) {}

  login(server: RuntimeMcpServerInput, options: McpLoginOptions = {}): Promise<void> {
    const identity = tokenKey(server);
    const existing = this.logins.get(server.key);
    if (existing) {
      if (existing.identity !== identity) return Promise.reject(new Error('MCP configuration changed during sign-in. Cancel the previous sign-in first.'));
      return existing.promise;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000), ...(options.signal ? [options.signal] : [])]);
    const pending: PendingLogin = { identity, controller, promise: Promise.resolve() };
    pending.promise = (async () => {
      const storage = await this.credentials.status();
      if (!storage.available) throw new Error('Secure credential storage is unavailable.');
      const tokens = await performDeviceOAuth(mcpDeviceOAuthProvider(server)!, {
        fetch: this.fetch, signal, now: this.now,
        onAuthorization: async (challenge) => {
          // Preparing a challenge has no desktop side effects; the user opens it from the dialog.
          signal.throwIfAborted();
          pending.challenge = challenge;
        },
      });
      signal.throwIfAborted();
      await this.credentials.set(identity, JSON.stringify({ tokens, savedAt: this.now() } satisfies StoredTokens));
      this.errors.delete(server.key);
    })().catch((error: unknown) => {
      if (!signal.aborted) this.errors.set(server.key, error instanceof Error ? error.message : 'Device authorization failed.');
      throw error;
    }).finally(() => {
      if (this.logins.get(server.key) === pending) this.logins.delete(server.key);
    });
    this.errors.delete(server.key);
    this.logins.set(server.key, pending);
    return pending.promise;
  }

  async status(server: RuntimeMcpServerInput): Promise<McpAuthStatusResult> {
    const pending = this.logins.get(server.key);
    if (pending?.identity === tokenKey(server)) {
      return { status: 'oAuthLoggingIn', ...(pending.challenge ? { deviceAuthorization: { ...pending.challenge } } : {}) };
    }
    const error = this.errors.get(server.key);
    if (error) return { status: 'oAuthError', error };
    try {
      const stored = await this.readTokens(server);
      if (!stored) return { status: 'notLoggedIn' };
      // Expired access tokens with a refresh token renew on the next MCP request.
      return { status: expired(stored, this.now()) && !stored.tokens.refresh_token ? 'oAuthExpired' : 'oAuth' };
    } catch {
      return { status: 'oAuthError', error: 'Could not read securely stored GitHub credentials. Sign in again.' };
    }
  }

  fetchFor(server: RuntimeMcpServerInput): DeviceOAuthFetch {
    return async (input, init) => {
      if (new URL(input).origin !== new URL(server.url!).origin) throw new Error('Refusing to send MCP credentials to another origin.');
      const identity = tokenKey(server);
      const logoutVersion = this.logoutVersions.get(identity);
      let stored = await this.readTokens(server);
      const assertActive = () => {
        if (this.logoutVersions.get(identity) !== logoutVersion) throw new DOMException('GitHub session signed out.', 'AbortError');
      };
      assertActive();
      if (!stored) throw new Error(`MCP server '${server.key}' requires GitHub sign-in.`);
      if (expired(stored, this.now(), 30_000)) stored = await this.refreshTokens(server, stored);
      assertActive();
      init?.signal?.throwIfAborted();
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${stored.tokens.access_token}`);
      const response = await this.fetch(input, { ...init, headers, redirect: 'error' });
      if (response.status === 401) this.errors.set(server.key, 'GitHub authorization was rejected. Sign in again.');
      return response;
    };
  }

  async logout(server: RuntimeMcpServerInput): Promise<void> {
    const identity = tokenKey(server);
    // A vault read may already be in flight before its request/refresh is registered.
    this.logoutVersions.set(identity, (this.logoutVersions.get(identity) ?? 0) + 1);
    const login = this.logins.get(server.key);
    const refresh = this.refreshes.get(tokenKey(server));
    login?.controller.abort();
    refresh?.controller.abort();
    // Wait for any vault write before deleting, so a late response cannot restore logged-out tokens.
    await Promise.allSettled([login?.promise, refresh?.promise]);
    await this.credentials.delete(tokenKey(server));
    this.errors.delete(server.key);
  }

  async shutdown(): Promise<void> {
    for (const login of this.logins.values()) login.controller.abort();
    for (const refresh of this.refreshes.values()) refresh.controller.abort();
    await Promise.allSettled([...this.logins.values(), ...this.refreshes.values()].map((pending) => pending.promise));
  }

  clearError(serverKey: string): void { this.errors.delete(serverKey); }

  private async readTokens(server: RuntimeMcpServerInput): Promise<StoredTokens | undefined> {
    const value = await this.credentials.get(tokenKey(server));
    if (!value) return undefined;
    const stored = JSON.parse(value) as StoredTokens;
    if (!Number.isFinite(stored.savedAt) || !stored.tokens?.access_token) throw new Error('Invalid stored device credentials.');
    return stored;
  }

  private refreshTokens(server: RuntimeMcpServerInput, stored: StoredTokens): Promise<StoredTokens> {
    if (!stored.tokens.refresh_token) return Promise.reject(new Error('GitHub authorization expired. Sign in again.'));
    const identity = tokenKey(server);
    const existing = this.refreshes.get(identity);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = refreshDeviceOAuth(mcpDeviceOAuthProvider(server)!, stored.tokens.refresh_token, this.fetch, controller.signal)
      .then(async (tokens) => {
        controller.signal.throwIfAborted();
        const refreshed: StoredTokens = { tokens, savedAt: this.now() };
        await this.credentials.set(identity, JSON.stringify(refreshed));
        return refreshed;
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) this.errors.set(server.key, 'GitHub authorization could not be renewed. Sign in again.');
        throw error;
      }).finally(() => {
        if (this.refreshes.get(identity)?.promise === promise) this.refreshes.delete(identity);
      });
    this.refreshes.set(identity, { controller, promise });
    return promise;
  }
}

function tokenKey(server: RuntimeMcpServerInput): string {
  // Vault lookup namespace from public server coordinates and client id, not a password verifier.
  const identity = `${server.key}\0${server.url}\0${mcpDeviceOAuthProvider(server)?.clientId}`;
  return `mcp.device-oauth.${createHash('sha256').update(identity).digest('hex')}`;
}

function expired(stored: StoredTokens, now: number, margin = 0): boolean {
  return typeof stored.tokens.expires_in === 'number' && stored.savedAt + stored.tokens.expires_in * 1_000 <= now + margin;
}
