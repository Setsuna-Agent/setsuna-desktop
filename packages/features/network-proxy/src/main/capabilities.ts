import type {
  DesktopNetworkProxyScope,
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
  DesktopSandboxNetworkEnvironment,
  DesktopNetworkProxyState,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { BrowserWindow } from 'electron';

export interface NetworkProxyCredentialVault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type NetworkProxyJsonWriter = (filePath: string, value: unknown) => Promise<void>;

export interface NetworkProxyMainHost {
  readonly configPath: string;
  readonly credentialVault: NetworkProxyCredentialVault;
  readonly mainWindow: BrowserWindow;
  readonly writeJsonAtomically: NetworkProxyJsonWriter;
  deleteServerThroughRuntime(proxyServerId: string): Promise<DesktopNetworkProxyState>;
  systemFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response>;
}

/** Narrow desktop service consumed by host adapters after Feature activation. */
export interface NetworkProxyMainService {
  deleteServer(proxyServerId: string): Promise<DesktopNetworkProxyState>;
  environmentFor(scope: DesktopNetworkProxyScope): Promise<Record<string, string | null>>;
  fetch(
    scope: DesktopNetworkProxyScope,
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response>;
  resolve(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy>;
  resolveSandboxNetworkEnvironment(): Promise<DesktopSandboxNetworkEnvironment>;
  validateServerReferences(proxyServerIds: readonly string[]): Promise<void>;
}

export const networkProxyMainHostCapability: CapabilityToken<NetworkProxyMainHost> = defineCapability({
  id: 'network-proxy.main-host',
  description: 'Desktop storage, credentials, window, runtime, and system networking for proxy routing',
});

export const networkProxyMainServiceCapability: CapabilityToken<NetworkProxyMainService> = defineCapability({
  id: 'network-proxy.main-service',
  description: 'Activated desktop proxy routing and network access used by host adapters',
});
