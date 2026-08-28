import { createContext, useContext, type ReactNode } from 'react';

export type ArtifactBrowserOpenHandler = (url: string) => void;

const ArtifactBrowserNavigationContext = createContext<ArtifactBrowserOpenHandler | null>(null);

export function ArtifactBrowserNavigationProvider({
  children,
  onOpenBrowser,
}: Readonly<{
  children: ReactNode;
  onOpenBrowser: ArtifactBrowserOpenHandler;
}>) {
  return (
    <ArtifactBrowserNavigationContext.Provider value={onOpenBrowser}>
      {children}
    </ArtifactBrowserNavigationContext.Provider>
  );
}

export function useArtifactBrowserNavigation(): ArtifactBrowserOpenHandler | null {
  return useContext(ArtifactBrowserNavigationContext);
}
