import type { DesktopNativeBridge, SecretStoreStatus } from '../../ports/secret-store.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpDesktopNativeBridge implements DesktopNativeBridge {
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
      });
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
}

function unavailableError(): Error {
  return new Error('Secure credential storage requires the Setsuna Desktop host.');
}
