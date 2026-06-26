import { useCallback, useEffect, useState } from 'react';
import type {
  DesktopRuntimeClient,
  WorkspaceEntry,
  WorkspaceFileRead,
  WorkspaceSearchResult,
} from '@setsuna-desktop/contracts';

type ProjectWorkspaceOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  onOpenFilePanel: (filePath: string) => void;
  onResetPanels: () => void;
};

export function useProjectWorkspace({ activeProjectId, client, onOpenFilePanel, onResetPanels }: ProjectWorkspaceOptions) {
  const [filePreview, setFilePreview] = useState<WorkspaceFileRead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);

  const resetWorkspacePanels = useCallback(() => {
    setFilePreview(null);
    setSearchResults([]);
    onResetPanels();
  }, [onResetPanels]);

  useEffect(() => {
    if (!activeProjectId) {
      setFilePreview(null);
    }
  }, [activeProjectId]);

  const openEntry = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!activeProjectId) return;
      if (entry.type === 'directory') {
        setFilePreview(null);
        return;
      }
      const file = await client.readProjectFile(activeProjectId, entry.path);
      setFilePreview(file);
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, onOpenFilePanel],
  );

  const openProjectFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectId) return;
      const file = await client.readProjectFile(activeProjectId, filePath);
      setFilePreview(file);
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, onOpenFilePanel],
  );

  const searchProjectEntries = useCallback(
    async (query = '', parent?: string | null) => {
      if (!activeProjectId) return [];
      const result = await client.searchProjectEntries(activeProjectId, query, parent);
      return result.entries;
    },
    [activeProjectId, client],
  );

  const searchProject = useCallback(async () => {
    if (!activeProjectId || !searchQuery.trim()) return;
    const result = await client.searchProject(activeProjectId, searchQuery);
    setSearchResults(result.results);
  }, [activeProjectId, client, searchQuery]);

  return {
    filePreview,
    openEntry,
    openProjectFile,
    resetWorkspacePanels,
    searchProject,
    searchProjectEntries,
    searchQuery,
    searchResults,
    setFilePreview,
    setSearchQuery,
  };
}

export type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>;
