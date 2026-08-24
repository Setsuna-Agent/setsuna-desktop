import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { NetworkProxyRendererStateService } from './service.js';

const NetworkProxyRendererContext = createContext<NetworkProxyRendererStateService | null>(null);

export function NetworkProxyRendererProvider({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: NetworkProxyRendererStateService;
}>) {
  return (
    <NetworkProxyRendererContext.Provider value={service}>
      {children}
    </NetworkProxyRendererContext.Provider>
  );
}

export function useNetworkProxyRendererService(): NetworkProxyRendererStateService {
  const service = useContext(NetworkProxyRendererContext);
  if (!service) {
    throw new Error('Network proxy renderer service is unavailable outside its Feature boundary.');
  }
  return service;
}

export function useNetworkProxyServiceView(service: NetworkProxyRendererStateService) {
  const snapshot = useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot);
  return {
    ...snapshot,
    available: service.available,
    deleteServer: service.deleteServer,
    setRouting: service.setRouting,
    upsertServer: service.upsertServer,
  };
}

export function useNetworkProxyView() {
  return useNetworkProxyServiceView(useNetworkProxyRendererService());
}

export type NetworkProxyRendererView = ReturnType<typeof useNetworkProxyView>;
