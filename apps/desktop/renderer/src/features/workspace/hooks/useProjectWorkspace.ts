import type {
  DesktopRuntimeClient,
  WorkspaceEntry,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceSearchResult,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import type { WorkspaceFileFocusRequest } from '../model.js';
import { useWorkspaceFileDraft } from './useWorkspaceFileDraft.js';

type ProjectWorkspaceOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  onOpenFilePanel: (filePath: string) => void;
};

export function useProjectWorkspace({ activeProjectId, client, onOpenFilePanel }: ProjectWorkspaceOptions) {
  const [filePreview, setFilePreview] = useState<WorkspaceFileRead | null>(null);
  const [fileFocusRequest, setFileFocusRequest] = useState<WorkspaceFileFocusRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const previousProjectIdRef = useRef(activeProjectId);
  const activeProjectIdRef = useRef(activeProjectId);
  const filePreviewRequests = useLatestRequestGuard();
  const contentSearchRequests = useLatestRequestGuard();
  activeProjectIdRef.current = activeProjectId;
  const fileDraft = useWorkspaceFileDraft({
    client,
    file: filePreview,
    onFilePrepared: setFilePreview,
    onFileSaved: setFilePreview,
  });
  const { confirmDiscardChanges } = fileDraft;

  const resetProjectWorkspaceState = useCallback(() => {
    filePreviewRequests.invalidate();
    contentSearchRequests.invalidate();
    setFilePreview(null);
    setFileFocusRequest(null);
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
        if (!confirmDiscardChanges()) return;
        filePreviewRequests.invalidate();
        setFilePreview(null);
        setFileFocusRequest(null);
        return;
      }
      if (filePreview?.path === entry.path && filePreview.projectId === activeProjectId) {
        setFileFocusRequest(null);
        onOpenFilePanel(filePreview.path);
        return;
      }
      if (!confirmDiscardChanges()) return;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      const file = await client.readProjectFile(projectId, entry.path);
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
      setFilePreview(file);
      setFileFocusRequest(null);
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, confirmDiscardChanges, filePreview, filePreviewRequests, onOpenFilePanel],
  );

  const openProjectFile = useCallback(
    async (filePath: string, line?: number) => {
      if (!activeProjectId) return;
      if (filePreview?.path === filePath && filePreview.projectId === activeProjectId) {
        setFileFocusRequest((current) => createFileFocusRequest(
          filePreview.path,
          line,
          current,
        ));
        onOpenFilePanel(filePreview.path);
        return;
      }
      if (!confirmDiscardChanges()) return;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      const file = await client.readProjectFile(projectId, filePath);
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
      setFilePreview(file);
      setFileFocusRequest((current) => createFileFocusRequest(
        file.path,
        line,
        current,
      ));
      onOpenFilePanel(file.path);
    },
    [activeProjectId, client, confirmDiscardChanges, filePreview, filePreviewRequests, onOpenFilePanel],
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
    if (file?.projectId !== filePreview?.projectId || file?.path !== filePreview?.path) {
      if (!confirmDiscardChanges()) return;
    }
    filePreviewRequests.invalidate();
    setFilePreview(file);
    setFileFocusRequest(null);
  }, [confirmDiscardChanges, filePreview?.path, filePreview?.projectId, filePreviewRequests]);

  return {
    // Effects clear project-bound state after commit; derive visibility now so a switch never renders the previous file.
    filePreview: visibleWorkspaceFilePreview(filePreview, activeProjectId),
    fileFocusRequest,
    fileDraft,
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

function createFileFocusRequest(
  path: string,
  line: number | undefined,
  current: WorkspaceFileFocusRequest | null,
): WorkspaceFileFocusRequest | null {
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1) return null;
  return {
    line,
    path,
    version: (current?.version ?? 0) + 1,
  };
}

export function visibleWorkspaceFilePreview(
  filePreview: WorkspaceFileRead | null,
  activeProjectId: string | null,
): WorkspaceFileRead | null {
  return filePreview?.projectId === activeProjectId ? filePreview : null;
}

export type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>;
