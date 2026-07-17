import { createHash } from 'node:crypto';
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RuntimeMcpAuthStatus, RuntimeMcpServerInput } from '@setsuna-desktop/contracts';
import type { DesktopNativeBridge } from '../../ports/secret-store.js';
import { McpOAuthCallbackServer } from './mcp-oauth-callback-server.js';

type StoredOAuthTokens = {
  savedAt: string;
  tokens: OAuthTokens;
};

type SerializedResponse = {
  body: ArrayBuffer;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
};

type LoginOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class McpOAuthLoginRequiredError extends Error {
  constructor(readonly serverKey: string) {
    super(`MCP server '${serverKey}' requires OAuth login.`);
  }
}

/** 按服务器管理安全 OAuth 状态、交互式登录及合并刷新。 */
export class McpOAuthCoordinator {
  private readonly logins = new Map<string, Promise<void>>();
  private readonly loginControllers = new Map<string, AbortController>();
  private readonly refreshes = new Map<string, Promise<SerializedResponse>>();
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly nativeBridge: DesktopNativeBridge,
    private readonly now: () => number = Date.now,
  ) {}

  providerFor(server: RuntimeMcpServerInput): OAuthClientProvider {
    return new SecureMcpOAuthProvider({
      interactive: false,
      nativeBridge: this.nativeBridge,
      redirectUrl: 'http://127.0.0.1/oauth/callback',
      server,
      state: '',
      tolerateUnavailable: true,
    });
  }

  fetchFor(serverKey: string): typeof fetch {
    return async (input, init) => {
      if (!isRefreshRequest(init?.body)) return fetch(input, init);
      let refresh = this.refreshes.get(serverKey);
      if (!refresh) {
        refresh = fetch(input, init).then(serializeResponse).finally(() => {
          if (this.refreshes.get(serverKey) === refresh) this.refreshes.delete(serverKey);
        });
        this.refreshes.set(serverKey, refresh);
      }
      return deserializeResponse(await refresh);
    };
  }

  async login(server: RuntimeMcpServerInput, options: LoginOptions = {}): Promise<void> {
    const existing = this.logins.get(server.key);
    if (existing) return existing;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    this.loginControllers.set(server.key, controller);
    const login = this.performLogin(server, { ...options, signal }).finally(() => {
      if (this.logins.get(server.key) === login) this.logins.delete(server.key);
      if (this.loginControllers.get(server.key) === controller) this.loginControllers.delete(server.key);
    });
    this.logins.set(server.key, login);
    return login;
  }

  async logout(server: RuntimeMcpServerInput): Promise<void> {
    this.loginControllers.get(server.key)?.abort(new Error(`MCP OAuth login for '${server.key}' was cancelled by logout.`));
    const keys = oauthCredentialKeys(server);
    await Promise.allSettled([
      this.nativeBridge.delete(keys.tokens),
      this.nativeBridge.delete(keys.client),
      this.nativeBridge.delete(keys.verifier),
      this.nativeBridge.delete(keys.discovery),
    ]);
    this.errors.delete(server.key);
  }

  async shutdown(): Promise<void> {
    for (const controller of this.loginControllers.values()) {
      controller.abort(new Error('MCP OAuth runtime is shutting down.'));
    }
    await Promise.allSettled(this.logins.values());
    this.loginControllers.clear();
  }

  async authStatus(server: RuntimeMcpServerInput): Promise<{ status: RuntimeMcpAuthStatus; error?: string }> {
    if (this.logins.has(server.key)) return { status: 'oAuthLoggingIn' };
    const error = this.errors.get(server.key);
    if (error) return { status: 'oAuthError', error };
    try {
      const stored = await readStoredTokens(this.nativeBridge, oauthCredentialKeys(server).tokens, true);
      if (!stored) return { status: server.oauthClientId || server.oauthResource ? 'notLoggedIn' : 'unsupported' };
      const expiresIn = stored.tokens.expires_in;
      const savedAt = Date.parse(stored.savedAt);
      if (typeof expiresIn === 'number' && Number.isFinite(savedAt) && savedAt + expiresIn * 1000 <= this.now()) {
        return { status: 'oAuthExpired' };
      }
      return { status: 'oAuth' };
    } catch (statusError) {
      return { status: 'oAuthError', error: errorMessage(statusError) };
    }
  }

  recordAuthError(serverKey: string, error: unknown): void {
    this.errors.set(serverKey, errorMessage(error));
  }

  clearAuthError(serverKey: string): void {
    this.errors.delete(serverKey);
  }

  private async performLogin(server: RuntimeMcpServerInput, options: LoginOptions): Promise<void> {
    const status = await this.nativeBridge.status();
    if (!status.available) {
      throw new Error(`Secure credential storage is unavailable (backend: ${status.backend}).`);
    }
    const callback = new McpOAuthCallbackServer();
    const redirectUrl = await callback.start();
    const provider = new SecureMcpOAuthProvider({
      interactive: true,
      nativeBridge: this.nativeBridge,
      redirectUrl,
      server,
      state: callback.state,
      tolerateUnavailable: false,
    });
    try {
      const callbackPromise = callback.wait(options.signal, options.timeoutMs);
      void callbackPromise.catch(() => undefined);
      const result = await auth(provider, {
        serverUrl: requiredServerUrl(server),
        fetchFn: this.fetchFor(server.key),
      });
      if (result === 'REDIRECT') {
        const { code } = await callbackPromise;
        const completed = await auth(provider, {
          serverUrl: requiredServerUrl(server),
          authorizationCode: code,
          fetchFn: this.fetchFor(server.key),
        });
        if (completed !== 'AUTHORIZED') throw new Error('MCP OAuth authorization did not complete.');
      }
      this.errors.delete(server.key);
    } catch (error) {
      this.errors.set(server.key, errorMessage(error));
      throw error;
    } finally {
      await callback.close().catch(() => undefined);
    }
  }
}

class SecureMcpOAuthProvider implements OAuthClientProvider {
  private readonly keys: ReturnType<typeof oauthCredentialKeys>;

  constructor(private readonly options: {
    interactive: boolean;
    nativeBridge: DesktopNativeBridge;
    redirectUrl: string;
    server: RuntimeMcpServerInput;
    state: string;
    tolerateUnavailable: boolean;
  }) {
    this.keys = oauthCredentialKeys(options.server);
  }

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.options.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Setsuna Desktop',
      software_id: 'dev.setsuna.desktop',
      software_version: '0.1.0',
    };
  }

  state(): string {
    return this.options.state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.options.server.oauthClientId) return { client_id: this.options.server.oauthClientId };
    return readJsonCredential<OAuthClientInformationMixed>(this.options.nativeBridge, this.keys.client, this.options.tolerateUnavailable);
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    return this.options.nativeBridge.set(this.keys.client, JSON.stringify(clientInformation));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readStoredTokens(this.options.nativeBridge, this.keys.tokens, this.options.tolerateUnavailable))?.tokens;
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored: StoredOAuthTokens = { savedAt: new Date().toISOString(), tokens };
    return this.options.nativeBridge.set(this.keys.tokens, JSON.stringify(stored));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.options.interactive) throw new McpOAuthLoginRequiredError(this.options.server.key);
    await this.options.nativeBridge.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.options.nativeBridge.set(this.keys.verifier, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.options.nativeBridge.get(this.keys.verifier);
    if (!verifier) throw new Error('MCP OAuth PKCE verifier is missing.');
    return verifier;
  }

  async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    const configured = this.options.server.oauthResource?.trim();
    const selected = configured || resource;
    if (!selected) return undefined;
    const url = new URL(selected);
    if (url.username || url.password || url.hash || !isSecureOAuthUrl(url)) {
      throw new Error('MCP OAuth resource must be HTTPS or a loopback HTTP URL without credentials or fragments.');
    }
    return url;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const keys = scope === 'all'
      ? [this.keys.client, this.keys.tokens, this.keys.verifier, this.keys.discovery]
      : [this.keys[scope]];
    await Promise.allSettled(keys.map((key) => this.options.nativeBridge.delete(key)));
  }

  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    return this.options.nativeBridge.set(this.keys.discovery, JSON.stringify(state));
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return readJsonCredential<OAuthDiscoveryState>(this.options.nativeBridge, this.keys.discovery, this.options.tolerateUnavailable);
  }
}

function oauthCredentialKeys(server: RuntimeMcpServerInput) {
  const identity = createHash('sha256').update(`${server.key}\0${server.url ?? ''}`).digest('hex');
  const prefix = `mcp.oauth.${identity}`;
  return {
    client: `${prefix}.client`,
    tokens: `${prefix}.tokens`,
    verifier: `${prefix}.verifier`,
    discovery: `${prefix}.discovery`,
  } as const;
}

async function readStoredTokens(
  nativeBridge: DesktopNativeBridge,
  key: string,
  tolerateUnavailable: boolean,
): Promise<StoredOAuthTokens | undefined> {
  return readJsonCredential<StoredOAuthTokens>(nativeBridge, key, tolerateUnavailable);
}

async function readJsonCredential<T>(
  nativeBridge: DesktopNativeBridge,
  key: string,
  tolerateUnavailable: boolean,
): Promise<T | undefined> {
  try {
    const value = await nativeBridge.get(key);
    return value ? JSON.parse(value) as T : undefined;
  } catch (error) {
    if (tolerateUnavailable) return undefined;
    throw error;
  }
}

function requiredServerUrl(server: RuntimeMcpServerInput): URL {
  const raw = server.url?.trim();
  if (!raw) throw new Error(`HTTP MCP server '${server.key}' requires a URL for OAuth.`);
  const url = new URL(raw);
  if (!isSecureOAuthUrl(url)) throw new Error('MCP OAuth requires HTTPS or a loopback HTTP server URL.');
  return url;
}

function isSecureOAuthUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname.toLowerCase() === 'localhost';
}

function isRefreshRequest(body: BodyInit | null | undefined): boolean {
  if (body instanceof URLSearchParams) return body.get('grant_type') === 'refresh_token';
  return typeof body === 'string' && new URLSearchParams(body).get('grant_type') === 'refresh_token';
}

async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  return {
    body: await response.arrayBuffer(),
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

function deserializeResponse(response: SerializedResponse): Response {
  return new Response(response.body.slice(0), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
