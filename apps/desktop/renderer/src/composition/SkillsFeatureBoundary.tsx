import type {
  SkillsRendererService,
  SkillsRendererSnapshot,
} from '@setsuna-desktop/feature-skills/contracts';
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const SkillsFeatureContext = createContext<SkillsRendererService | null>(null);

export function SkillsFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: SkillsRendererService;
}>) {
  return (
    <SkillsFeatureContext.Provider value={service}>
      {children}
    </SkillsFeatureContext.Provider>
  );
}

export function useSkillsFeature(): Readonly<{
  service: SkillsRendererService;
  snapshot: SkillsRendererSnapshot;
}> {
  const service = useSkillsFeatureService();
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  return { service, snapshot };
}

export function useSkillsFeatureService(): SkillsRendererService {
  const service = useContext(SkillsFeatureContext);
  if (!service) throw new Error('SkillsFeatureServiceBoundary is missing.');
  return service;
}
