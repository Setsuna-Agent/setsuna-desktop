import type {
  DesktopRuntimeClient,
  WorkspaceEntry,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceSearchResult,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';

type ProjectWorkspaceOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  onOpenFilePanel: (filePath: string) => void;
};

export function useProjectWorkspace({ activeProjectId, client, onOpenFilePanel }: ProjectWorkspaceOptions) {
  const [filePreview, setFilePreview] = useState<WorkspaceFileRead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const previousProjectIdRef = useRef(activeProjectId);
  const activeProjectIdRef = useRef(activeProjectId);
  const filePreviewRequests = useLatestRequestGuard();
  const contentSearchRequests = useLatestRequestGuard();
  activeProjectIdRef.current = activeProjectId;

  const resetProjectWorkspaceState = useCallback(() => {
    filePreviewRequests.invalidate();
    contentSearchRequests.invalidate();
    setFilePreview(null);
    setSearchQuery('');
    setSearchResults([]);
  }, [contentSearchRequests, filePreviewRequests]);

  useEffect(() => {
    if (previousProjectIdRef.current === activeProjectId) return;
    previousProjectIdRef.current = activeProjectId;
    resetProjectWorkspaceState();
  }, [activeProjectId, resetProjectWorkspaceState]);

  const openEntry = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!activeProjectId) return;
      if (entry.type === 'directory') {
        filePreviewRequests.invalidate();
        setFilePreview(null);
        return;
      }
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      const file = await client.readProjectFile(projectId, entry.path);
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
      setFilePreview(file);
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, filePreviewRequests, onOpenFilePanel],
  );

  const openProjectFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectId) return;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      const file = await client.readProjectFile(projectId, filePath);
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
      setFilePreview(file);
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, filePreviewRequests, onOpenFilePanel],
  );

  const searchProjectEntries = useCallback(
    async (query = '', parent?: string | null): Promise<WorkspaceEntrySearchResponse> => {
      if (!activeProjectId) {
        return { entries: [], query: query.trim().toLowerCase(), scanned: 0, truncated: false, workspaceRoot: '' };
      }
      const result = await client.searchProjectEntries(activeProjectId, query, parent);
      return result;
    },
    [activeProjectId, client],
  );

  const searchProject = useCallback(async () => {
    if (!activeProjectId || !searchQuery.trim()) return;
    const projectId = activeProjectId;
    const query = searchQuery;
    const isLatest = contentSearchRequests.begin();
    const result = await client.searchProject(projectId, query);
    if (result.superseded || !isLatest() || activeProjectIdRef.current !== projectId) return;
    setSearchResults(result.results);
  }, [activeProjectId, client, contentSearchRequests, searchQuery]);

  const updateFilePreview = useCallback((file: WorkspaceFileRead | null) => {
    filePreviewRequests.invalidate();
    setFilePreview(file);
  }, [filePreviewRequests]);

  return {
    // Effects clear project-bound state after commit; derive visibility now so a switch never renders the previous file.
    filePreview: visibleWorkspaceFilePreview(filePreview, activeProjectId),
    openEntry,
    openProjectFile,
    resetProjectWorkspaceState,
    searchProject,
    searchProjectEntries,
    searchQuery,
    searchResults,
    setFilePreview: updateFilePreview,
    setSearchQuery,
  };
}

export function visibleWorkspaceFilePreview(
  filePreview: WorkspaceFileRead | null,
  activeProjectId: string | null,
): WorkspaceFileRead | null {
  return filePreview?.projectId === activeProjectId ? filePreview : null;
}

export type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>;
