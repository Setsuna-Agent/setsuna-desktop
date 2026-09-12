import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { WorkspaceFileContextTarget } from '../../workspace/WorkspaceFileContextMenu.js';
import { useMarkdownWorkspaceFiles, type MarkdownWorkspaceFiles, type SearchMarkdownWorkspaceEntries } from './useMarkdownWorkspaceFiles.js';

export type MarkdownNavigationContextValue = {
  onOpenInAppBrowser?: (url: string) => void;
  onOpenWebLink?: (url: string) => void;
  onOpenWorkspaceDirectory?: (directoryPath: string) => void;
  onOpenWorkspaceFile?: (filePath: string, line?: number) => void;
  onOpenWorkspaceFileContextMenu?: (target: WorkspaceFileContextTarget) => void;
  workspaceRoot?: string;
  workspaceFiles?: MarkdownWorkspaceFiles;
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
  onSearchWorkspaceEntries,
}: Omit<MarkdownNavigationContextValue, 'workspaceFiles'> & {
  children: ReactNode;
  onSearchWorkspaceEntries?: SearchMarkdownWorkspaceEntries;
}) {
  const workspaceFiles = useMarkdownWorkspaceFiles(workspaceRoot, onSearchWorkspaceEntries);
  const value = useMemo(
    () => ({
      onOpenInAppBrowser,
      onOpenWebLink,
      onOpenWorkspaceDirectory,
      onOpenWorkspaceFile,
      onOpenWorkspaceFileContextMenu,
      workspaceRoot,
      workspaceFiles,
    }),
    [
      onOpenInAppBrowser,
      onOpenWebLink,
      onOpenWorkspaceDirectory,
      onOpenWorkspaceFile,
      onOpenWorkspaceFileContextMenu,
      workspaceRoot,
      workspaceFiles,
    ],
  );
  return <MarkdownNavigationContext.Provider value={value}>{children}</MarkdownNavigationContext.Provider>;
}

export function useMarkdownNavigation(): MarkdownNavigationContextValue {
  return useContext(MarkdownNavigationContext);
}
