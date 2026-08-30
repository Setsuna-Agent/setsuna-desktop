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

export function usePluginManagementFeatureSnapshot(): PluginManagementSnapshot {
  return usePluginManagementSnapshot(usePluginManagementFeatureService());
}

function usePluginManagementFeatureService(): PluginManagementRendererService {
  const service = useContext(PluginManagementFeatureContext);
  if (!service) throw new Error('PluginManagementFeatureServiceBoundary is missing.');
  return service;
}

function usePluginManagementSnapshot(
  service: PluginManagementRendererService,
): PluginManagementSnapshot {
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
}
