import type {
  PluginManagementRendererService,
  PluginManagementSnapshot,
} from '@setsuna-desktop/feature-plugin-management/contracts';
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const PluginManagementFeatureContext = createContext<PluginManagementRendererService | null>(null);

export function PluginManagementFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: PluginManagementRendererService;
}>) {
  return (
    <PluginManagementFeatureContext.Provider value={service}>
      {children}
    </PluginManagementFeatureContext.Provider>
  );
}

export function usePluginManagementFeature(): Readonly<{
  service: PluginManagementRendererService;
  snapshot: PluginManagementSnapshot;
}> {
  const service = usePluginManagementFeatureService();
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  return { service, snapshot };
}

export function usePluginManagementFeatureService(): PluginManagementRendererService {
  const service = useContext(PluginManagementFeatureContext);
  if (!service) throw new Error('PluginManagementFeatureServiceBoundary is missing.');
  return service;
}
