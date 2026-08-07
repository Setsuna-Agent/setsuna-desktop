import type {
  DesktopSystemProxyFetchRequest,
  DesktopNetworkProxyState,
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import {
  DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER,
  DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES,
  DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES,
  DESKTOP_SYSTEM_PROXY_FETCH_PATH,
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

  async fetchWithSystemProxy(input: string | URL, init?: RequestInit): Promise<Response> {
    const targetRequest = new Request(input, init);
    const metadata: DesktopSystemProxyFetchRequest = {
      headers: headerEntries(targetRequest.headers),
      method: targetRequest.method,
      url: targetRequest.url,
    };
    const response = await fetch(new URL(
      DESKTOP_SYSTEM_PROXY_FETCH_PATH,
      `${this.baseUrl.replace(/\/$/u, '')}/`,
    ), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      // Metadata belongs in the framed body: provider tokens and MCP headers can
      // legitimately exceed Node's aggregate HTTP header limit on this bridge.
      body: framedSystemProxyRequestBody(metadata, targetRequest.body),
      signal: targetRequest.signal,
      dispatcher: this.directAgent,
      duplex: 'half',
    } as unknown as RequestInit);
    if (response.headers.get(DESKTOP_SYSTEM_PROXY_FETCH_ERROR_HEADER) === '1') {
      throw new Error(await response.text() || 'Desktop system proxy request failed.');
    }
    return response;
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

  fetchWithSystemProxy(input: string | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
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

function headerEntries(headers: Headers): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, name) => entries.push([name, value]));
  return entries;
}

function framedSystemProxyRequestBody(
  metadata: DesktopSystemProxyFetchRequest,
  body: ReadableStream<Uint8Array> | null,
): ReadableStream<Uint8Array> {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  if (metadataBytes.length > DESKTOP_SYSTEM_PROXY_FETCH_MAX_METADATA_BYTES) {
    throw new Error('Desktop system proxy request metadata is too large.');
  }
  const prefix = Buffer.allocUnsafe(DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES);
  prefix.writeUInt32BE(metadataBytes.length, 0);
  const firstChunk = Buffer.concat([prefix, metadataBytes]);
  const reader = body?.getReader();
  let sentMetadata = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentMetadata) {
        sentMetadata = true;
        controller.enqueue(firstChunk);
        if (!reader) controller.close();
        return;
      }
      if (!reader) return;
      try {
        const next = await reader.read();
        if (next.done) {
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (!reader) return;
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
