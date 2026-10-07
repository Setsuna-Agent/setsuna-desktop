import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type ArtifactBrowserOpenHandler = (url: string) => void;

type ArtifactNavigation = {
  onOpenBrowser: ArtifactBrowserOpenHandler;
  projectId?: string;
  onShowInFiles?: (filePath: string) => void | Promise<void>;
};

const ArtifactNavigationContext = createContext<ArtifactNavigation | null>(null);

export function ArtifactNavigationProvider({
  children,
  onOpenBrowser,
  projectId,
  onShowInFiles,
}: Readonly<ArtifactNavigation & {
  children: ReactNode;
}>) {
  const value = useMemo(() => ({ onOpenBrowser, projectId, onShowInFiles }), [onOpenBrowser, projectId, onShowInFiles]);
  return (
    <ArtifactNavigationContext.Provider value={value}>
      {children}
    </ArtifactNavigationContext.Provider>
  );
}

export function useArtifactNavigation(): ArtifactNavigation | null {
  return useContext(ArtifactNavigationContext);
}
