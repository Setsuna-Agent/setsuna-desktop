import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyState,
} from '@setsuna-desktop/contracts';

export const NETWORK_PROXY_IPC_CHANNELS = Object.freeze({
  getState: 'network-proxy:get-state',
  upsertServer: 'network-proxy:upsert-server',
  deleteServer: 'network-proxy:delete-server',
  setRouting: 'network-proxy:set-routing',
  stateChange: 'network-proxy:state-change',
} as const);

export interface NetworkProxyDesktopBridge {
  getState(): Promise<DesktopNetworkProxyState>;
  upsertServer(input: DesktopNetworkProxyServerInput): Promise<DesktopNetworkProxyState>;
  deleteServer(proxyServerId: string): Promise<DesktopNetworkProxyState>;
  setRouting(input: DesktopNetworkProxyRoutingInput): Promise<DesktopNetworkProxyState>;
  onStateChange(callback: (state: DesktopNetworkProxyState) => void): () => void;
}

export type NetworkProxyPreloadBridgeContribution = Readonly<{
  networkProxy: NetworkProxyDesktopBridge;
}>;
