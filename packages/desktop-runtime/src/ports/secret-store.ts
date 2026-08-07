import type {
  DesktopNetworkProxyState,
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';

export type SecretStoreStatus = {
  available: boolean;
  backend: string;
};

export interface SecretStore {
  status(): Promise<SecretStoreStatus>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DesktopNativeBridge extends SecretStore {
  close(): Promise<void>;
  deleteNetworkProxy(proxyServerId: string): Promise<DesktopNetworkProxyState>;
  fetchWithSystemProxy(input: string | URL, init?: RequestInit): Promise<Response>;
  openExternal(url: string): Promise<void>;
  resolveNetworkProxy(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy>;
  validateNetworkProxyReferences(proxyServerIds: readonly string[]): Promise<void>;
}
