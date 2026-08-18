import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WorkspaceFileContextTarget } from '../../workspace/WorkspaceFileContextMenu.js';

export type MarkdownNavigationContextValue = {
  onOpenInAppBrowser?: (url: string) => void;
  onOpenWebLink?: (url: string) => void;
  onOpenWorkspaceDirectory?: (directoryPath: string) => void;
  onOpenWorkspaceFile?: (filePath: string, line?: number) => void;
  onOpenWorkspaceFileContextMenu?: (target: WorkspaceFileContextTarget) => void;
  workspaceRoot?: string;
};

const MarkdownNavigationContext = createContext<MarkdownNavigationContextValue>({});

export function MarkdownNavigationProvider({
  children,
  onOpenInAppBrowser,
  onOpenWebLink,
  onOpenWorkspaceDirectory,
  onOpenWorkspaceFile,
  onOpenWorkspaceFileContextMenu,
  workspaceRoot,
}: MarkdownNavigationContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      onOpenInAppBrowser,
      onOpenWebLink,
      onOpenWorkspaceDirectory,
      onOpenWorkspaceFile,
      onOpenWorkspaceFileContextMenu,
      workspaceRoot,
    }),
    [
      onOpenInAppBrowser,
      onOpenWebLink,
      onOpenWorkspaceDirectory,
      onOpenWorkspaceFile,
      onOpenWorkspaceFileContextMenu,
      workspaceRoot,
    ],
  );
  return <MarkdownNavigationContext.Provider value={value}>{children}</MarkdownNavigationContext.Provider>;
}

export function useMarkdownNavigation(): MarkdownNavigationContextValue {
  return useContext(MarkdownNavigationContext);
}
