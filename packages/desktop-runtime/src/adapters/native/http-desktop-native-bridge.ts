import type {
  DesktopNetworkProxyState,
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import { Agent } from 'undici';
import type { DesktopNativeBridge, SecretStoreStatus } from '../../ports/secret-store.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpDesktopNativeBridge implements DesktopNativeBridge {
  private readonly directAgent = new Agent();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): DesktopNativeBridge {
    const baseUrl = env.SETSUNA_DESKTOP_NATIVE_BRIDGE_URL?.trim();
    const token = env.SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN?.trim();
    return baseUrl && token
      ? new HttpDesktopNativeBridge(baseUrl, token)
      : new UnavailableDesktopNativeBridge();
  }

  async close(): Promise<void> {
    await this.directAgent.close().catch(() => undefined);
  }

  status(): Promise<SecretStoreStatus> {
    return this.request('/v1/credentials/status', { method: 'GET' });
  }

  async get(key: string): Promise<string | undefined> {
    const response = await this.request<{ value?: unknown }>('/v1/credentials/get', {
      body: { key },
      method: 'POST',
    });
    return typeof response.value === 'string' ? response.value : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    await this.request('/v1/credentials/set', { body: { key, value }, method: 'POST' });
  }

  async delete(key: string): Promise<void> {
    await this.request('/v1/credentials/delete', { body: { key }, method: 'POST' });
  }

  async openExternal(url: string): Promise<void> {
    await this.request('/v1/external/open', { body: { url }, method: 'POST' });
  }

  deleteNetworkProxy(proxyServerId: string): Promise<DesktopNetworkProxyState> {
    return this.request('/v1/network-proxy/delete', {
      body: { proxyServerId },
      method: 'POST',
    });
  }

  resolveNetworkProxy(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy> {
    return this.request('/v1/network-proxy/resolve', { body: input, method: 'POST' });
  }

  async validateNetworkProxyReferences(proxyServerIds: readonly string[]): Promise<void> {
    await this.request('/v1/network-proxy/validate-references', {
      body: { proxyServerIds },
      method: 'POST',
    });
  }

  private async request<T>(pathname: string, options: { body?: unknown; method: 'GET' | 'POST' }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Desktop native bridge request timed out.')), DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetch(new URL(pathname, `${this.baseUrl.replace(/\/$/u, '')}/`), {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        dispatcher: this.directAgent,
      } as unknown as RequestInit);
      const text = await response.text();
      const body = text ? JSON.parse(text) as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Desktop native bridge failed: ${response.status}`);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class UnavailableDesktopNativeBridge implements DesktopNativeBridge {
  async close(): Promise<void> {}

  async status(): Promise<SecretStoreStatus> {
    return { available: false, backend: 'unavailable' };
  }

  async get(_key: string): Promise<string | undefined> {
    throw unavailableError();
  }

  async set(_key: string, _value: string): Promise<void> {
    throw unavailableError();
  }

  async delete(_key: string): Promise<void> {
    throw unavailableError();
  }

  async openExternal(_url: string): Promise<void> {
    throw new Error('Opening an external authorization page requires the Setsuna Desktop host.');
  }

  async deleteNetworkProxy(_proxyServerId: string): Promise<DesktopNetworkProxyState> {
    throw unavailableError();
  }

  async resolveNetworkProxy(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy> {
    if (input.override?.mode === 'proxy') {
      throw new Error('A configured network proxy requires the Setsuna Desktop host.');
    }
    return input.override?.mode === 'direct' ? { mode: 'direct' } : { mode: 'system' };
  }

  async validateNetworkProxyReferences(proxyServerIds: readonly string[]): Promise<void> {
    if (proxyServerIds.length) throw unavailableError();
  }
}

function unavailableError(): Error {
  return new Error('Secure credential storage requires the Setsuna Desktop host.');
}
