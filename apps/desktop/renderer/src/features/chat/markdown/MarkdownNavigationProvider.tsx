import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type MarkdownNavigationContextValue = {
  onOpenInAppBrowser?: (url: string) => void;
  onOpenWebLink?: (url: string) => void;
  onOpenWorkspaceFile?: (filePath: string, line?: number) => void;
  workspaceRoot?: string;
};

const MarkdownNavigationContext = createContext<MarkdownNavigationContextValue>({});

export function MarkdownNavigationProvider({
  children,
  onOpenInAppBrowser,
  onOpenWebLink,
  onOpenWorkspaceFile,
  workspaceRoot,
}: MarkdownNavigationContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ onOpenInAppBrowser, onOpenWebLink, onOpenWorkspaceFile, workspaceRoot }),
    [onOpenInAppBrowser, onOpenWebLink, onOpenWorkspaceFile, workspaceRoot],
  );
  return <MarkdownNavigationContext.Provider value={value}>{children}</MarkdownNavigationContext.Provider>;
}

export function useMarkdownNavigation(): MarkdownNavigationContextValue {
  return useContext(MarkdownNavigationContext);
}
