import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import { createContext, useContext, type ReactNode } from 'react';

const CapabilitiesRefreshContext = createContext<CapabilitiesRefreshCoordinator | null>(null);

export function CapabilitiesRefreshBoundary({
  children,
  coordinator,
}: Readonly<{
  children: ReactNode;
  coordinator: CapabilitiesRefreshCoordinator;
}>) {
  return (
    <CapabilitiesRefreshContext.Provider value={coordinator}>
      {children}
    </CapabilitiesRefreshContext.Provider>
  );
}

export function useCapabilitiesRefreshCoordinator(): CapabilitiesRefreshCoordinator {
  const coordinator = useContext(CapabilitiesRefreshContext);
  if (!coordinator) throw new Error('CapabilitiesRefreshBoundary is missing.');
  return coordinator;
}
