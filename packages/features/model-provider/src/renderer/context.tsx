import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ModelProviderRendererSnapshot, ModelProviderRendererStateService } from './service.js';

const ModelProviderContext = createContext<ModelProviderRendererStateService | null>(null);

export function ModelProviderRendererProvider({
  children,
  service,
}: Readonly<{ children: ReactNode; service: ModelProviderRendererStateService }>) {
  return <ModelProviderContext.Provider value={service}>{children}</ModelProviderContext.Provider>;
}

export function useModelProviderRendererService(): ModelProviderRendererStateService {
  const service = useContext(ModelProviderContext);
  if (!service) throw new Error('Model provider renderer service is unavailable.');
  return service;
}

export function useModelProviderSnapshot(
  service = useModelProviderRendererService(),
): ModelProviderRendererSnapshot {
  return useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot);
}
