import type {
  DesktopNetworkProxyState,
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import { defaultDesktopNetworkProxyRouting } from '@setsuna-desktop/contracts';
import type {
  DesktopNativeBridge,
  SecretStore,
  SecretStoreStatus,
} from '../../src/ports/secret-store.js';

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async status(): Promise<SecretStoreStatus> {
    return { available: true, backend: 'memory' };
  }

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class InMemoryDesktopNativeBridge extends InMemorySecretStore implements DesktopNativeBridge {
  readonly deletedNetworkProxyServerIds: string[] = [];
  readonly openedUrls: string[] = [];
  readonly validatedNetworkProxyServerIds: string[][] = [];

  async close(): Promise<void> {}

  fetchWithSystemProxy(input: string | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async deleteNetworkProxy(proxyServerId: string): Promise<DesktopNetworkProxyState> {
    this.deletedNetworkProxyServerIds.push(proxyServerId);
    return {
      configPath: 'memory://network-proxies.json',
      routing: defaultDesktopNetworkProxyRouting(),
      servers: [],
    };
  }

  async openExternal(url: string): Promise<void> {
    this.openedUrls.push(url);
  }

  async resolveNetworkProxy(_input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy> {
    return { mode: 'direct' };
  }

  async validateNetworkProxyReferences(proxyServerIds: readonly string[]): Promise<void> {
    this.validatedNetworkProxyServerIds.push([...proxyServerIds]);
  }
}
