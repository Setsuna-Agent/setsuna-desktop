import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type MarkdownNavigationContextValue = {
  onOpenWorkspaceFile?: (filePath: string, line?: number) => void;
  workspaceRoot?: string;
};

const MarkdownNavigationContext = createContext<MarkdownNavigationContextValue>({});

export function MarkdownNavigationProvider({
  children,
  onOpenWorkspaceFile,
  workspaceRoot,
}: MarkdownNavigationContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ onOpenWorkspaceFile, workspaceRoot }),
    [onOpenWorkspaceFile, workspaceRoot],
  );
  return <MarkdownNavigationContext.Provider value={value}>{children}</MarkdownNavigationContext.Provider>;
}

export function useMarkdownNavigation(): MarkdownNavigationContextValue {
  return useContext(MarkdownNavigationContext);
}
