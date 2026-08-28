import type {
  McpRendererService,
} from '@setsuna-desktop/feature-mcp/contracts';
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const McpFeatureContext = createContext<McpRendererService | null>(null);

export function McpFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: McpRendererService;
}>) {
  return (
    <McpFeatureContext.Provider value={service}>
      {children}
    </McpFeatureContext.Provider>
  );
}

export function useMcpFeature() {
  const service = useMcpFeatureService();
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  return { service, snapshot };
}

export function useMcpFeatureService(): McpRendererService {
  const service = useContext(McpFeatureContext);
  if (!service) throw new Error('McpFeatureServiceBoundary is missing.');
  return service;
}
