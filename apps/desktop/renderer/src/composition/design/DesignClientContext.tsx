import { createContext, useContext, type ReactNode } from 'react';
import type { DesignClient } from '@setsuna-desktop/feature-design/renderer';

const DesignClientContext = createContext<DesignClient | null>(null);

export function DesignFeatureServiceBoundary({ client, children }: Readonly<{ client: DesignClient | null; children: ReactNode }>) {
  return <DesignClientContext.Provider value={client}>{children}</DesignClientContext.Provider>;
}

export function useDesignClient(): DesignClient | null {
  return useContext(DesignClientContext);
}
