import type {
  DesktopRuntimeClient,
  WorkspaceEntry,
  WorkspaceEntryCreateInput,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceSearchResult,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { runtimeClientErrorMessage } from '../../../services/runtime-client/runtimeClientErrors.js';
import type { WorkspaceFileFocusRequest } from '../model.js';
import { useWorkspaceFileDraft } from './useWorkspaceFileDraft.js';
import { isWorkspaceEntryWithin, renamedWorkspaceEntryPath } from '../workspaceEntryPaths.js';

type ProjectWorkspaceOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  onOpenFilePanel: (filePath: string) => void;
  onEntryRenamed?: (previousPath: string, nextPath: string) => void;
  onEntryDeleted?: (entryPath: string) => void;
};

export function useProjectWorkspace({ activeProjectId, client, onOpenFilePanel, onEntryRenamed, onEntryDeleted }: ProjectWorkspaceOptions) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [filePreview, setFilePreview] = useState<WorkspaceFileRead | null>(null);
  const filePreviewRef = useRef(filePreview);
  filePreviewRef.current = filePreview;
  const [fileFocusRequest, setFileFocusRequest] = useState<WorkspaceFileFocusRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [entryOperationPending, setEntryOperationPending] = useState(false);
  const entryOperationRef = useRef(false);
  const previousProjectIdRef = useRef(activeProjectId);
  const activeProjectIdRef = useRef(activeProjectId);
  const filePreviewRequests = useLatestRequestGuard();
  const contentSearchRequests = useLatestRequestGuard();
  const entryMutationRequests = useIdentityRequestGuard(activeProjectId ?? '');
  activeProjectIdRef.current = activeProjectId;
  const isSaveBlocked = useCallback(() => entryOperationRef.current, []);
  const fileDraft = useWorkspaceFileDraft({
    client,
    file: filePreview,
    isSaveBlocked,
    onFilePrepared: setFilePreview,
    onFileSaved: setFilePreview,
  });
  const { confirmDiscardChanges } = fileDraft;
  const fileDraftRef = useRef(fileDraft);
  fileDraftRef.current = fileDraft;

  const resetProjectWorkspaceState = useCallback(() => {
    filePreviewRequests.invalidate();
    contentSearchRequests.invalidate();
    entryMutationRequests.invalidate();
    entryOperationRef.current = false;
    setEntryOperationPending(false);
    setFilePreview(null);
    setFileFocusRequest(null);
    setSearchQuery('');
    setSearchResults([]);
  }, [contentSearchRequests, entryMutationRequests, filePreviewRequests]);

  useEffect(() => {
    if (previousProjectIdRef.current === activeProjectId) return;
    previousProjectIdRef.current = activeProjectId;
    resetProjectWorkspaceState();
  }, [activeProjectId, resetProjectWorkspaceState]);

  const openEntry = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!activeProjectId) return;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      if (entry.type === 'directory') {
        if (!await confirmDiscardChanges()) return;
        if (!isLatest() || activeProjectIdRef.current !== projectId) return;
        setFilePreview(null);
        setFileFocusRequest(null);
        return;
      }
      if (filePreview?.path === entry.path && filePreview.projectId === activeProjectId) {
        setFileFocusRequest(null);
        onOpenFilePanel(filePreview.path);
        return;
      }
      if (!await confirmDiscardChanges()) return;
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
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
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      if (filePreview?.path === filePath && filePreview.projectId === activeProjectId) {
        setFileFocusRequest((current) => createFileFocusRequest(
          filePreview.path,
          line,
          current,
        ));
        onOpenFilePanel(filePreview.path);
        return;
      }
      if (!await confirmDiscardChanges()) return;
      if (!isLatest() || activeProjectIdRef.current !== projectId) return;
      try {
        const file = await client.readProjectFile(projectId, filePath);
        if (!isLatest() || activeProjectIdRef.current !== projectId) return;
        setFilePreview(file);
        setFileFocusRequest((current) => createFileFocusRequest(
          file.path,
          line,
          current,
        ));
        onOpenFilePanel(file.path);
      } catch (error) {
        if (!isLatest() || activeProjectIdRef.current !== projectId) return;
        const feedback = workspaceFileOpenFailureFeedback(filePath, error, t);
        toast[feedback.tone](feedback.message);
      }
    },
    [activeProjectId, client, confirmDiscardChanges, filePreview, filePreviewRequests, onOpenFilePanel, t, toast],
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

  const updateFilePreview = useCallback(async (file: WorkspaceFileRead | null): Promise<boolean> => {
    const isLatest = filePreviewRequests.begin();
    if (file?.projectId !== filePreview?.projectId || file?.path !== filePreview?.path) {
      if (!await confirmDiscardChanges()) return false;
    }
    if (!isLatest()) return false;
    setFilePreview(file);
    setFileFocusRequest(null);
    return true;
  }, [confirmDiscardChanges, filePreview?.path, filePreview?.projectId, filePreviewRequests]);

  const refreshFilePreview = useCallback(async (isCurrent: () => boolean): Promise<void> => {
    const previous = filePreviewRef.current;
    if (!previous || previous.projectId !== activeProjectIdRef.current
      || fileDraftRef.current.dirty || fileDraftRef.current.saving) return;
    try {
      const next = await client.readProjectFile(previous.projectId, previous.path);
      // A background read must not replace a newer selection, save, or local edit.
      if (!isCurrent() || filePreviewRef.current !== previous
        || activeProjectIdRef.current !== previous.projectId
        || fileDraftRef.current.dirty || fileDraftRef.current.saving) return;
      if (next.revision && next.revision === previous.revision) return;
      setFilePreview(next);
    } catch {
      // Atomic replacements can briefly remove the file; retain the last snapshot until the next notification.
    }
  }, [client]);

  const runEntryMutation = useCallback(async <T>(
    operation: (projectId: string, isCurrent: () => boolean) => Promise<T>,
  ): Promise<T | null> => {
    if (!activeProjectId || entryOperationRef.current) return null;
    const isCurrent = entryMutationRequests.begin();
    // Do not supersede an in-flight disk mutation: its result must still update the tree and tabs.
    entryOperationRef.current = true;
    setEntryOperationPending(true);
    try {
      const result = await operation(activeProjectId, isCurrent);
      return isCurrent() ? result : null;
    } catch (error) {
      if (isCurrent()) throw error;
      return null;
    } finally {
      if (isCurrent()) {
        entryOperationRef.current = false;
        setEntryOperationPending(false);
      }
    }
  }, [activeProjectId, entryMutationRequests]);

  const createEntry = useCallback((input: WorkspaceEntryCreateInput) => runEntryMutation(
    (projectId) => client.createProjectEntry(projectId, input),
  ), [client, runEntryMutation]);

  const relocateEntry = useCallback((entryPath: string, relocate: (projectId: string) => Promise<WorkspaceEntry>) => runEntryMutation(async (projectId, isCurrent) => {
    const preview = filePreviewRef.current;
    const affectsPreview = preview && isWorkspaceEntryWithin(preview.path, entryPath);
    if (affectsPreview && fileDraft.isSaving()) throw new Error(t('workspace.files.renameWhileSaving'));
    const entry = await relocate(projectId);
    if (!isCurrent()) return null;
    filePreviewRequests.invalidate();
    const current = filePreviewRef.current;
    if (current?.projectId === projectId) {
      const nextPath = renamedWorkspaceEntryPath(current.path, entryPath, entry.path);
      if (nextPath !== current.path) {
        const nextFile = { ...current, path: nextPath };
        fileDraft.relocateFile(nextFile);
        setFilePreview(nextFile);
        setFileFocusRequest((focus) => focus ? { ...focus, path: nextPath } : null);
      }
    }
    onEntryRenamed?.(entryPath, entry.path);
    return entry;
  }), [fileDraft, filePreviewRequests, onEntryRenamed, runEntryMutation, t]);

  const renameEntry = useCallback((entryPath: string, name: string) => relocateEntry(
    entryPath, (projectId) => client.renameProjectEntry(projectId, entryPath, { name }),
  ), [client, relocateEntry]);

  const moveEntry = useCallback((entryPath: string, parentPath: string) => relocateEntry(
    entryPath, (projectId) => client.moveProjectEntry(projectId, entryPath, { parentPath }),
  ), [client, relocateEntry]);

  const deleteEntry = useCallback(async (entryPath: string): Promise<boolean> => (await runEntryMutation(async (projectId, isCurrent) => {
    if (!entryPath) return false;
    const preview = filePreviewRef.current;
    const affectsPreview = preview && isWorkspaceEntryWithin(preview.path, entryPath);
    if (affectsPreview && fileDraft.isSaving()) {
      toast.error(t('workspace.files.deleteWhileSaving'));
      return false;
    }
    const approved = await confirm({
      title: t('workspace.files.deleteConfirm', { path: entryPath }),
      description: t('workspace.files.deletePermanent') + (affectsPreview && fileDraft.dirty
        ? ` ${t('workspace.files.deleteUnsaved')}` : ''),
      danger: true, confirmLabel: t('workspace.fileMenu.delete'),
    });
    if (!approved || !isCurrent()) return false;
    try {
      await client.deleteProjectEntry(projectId, entryPath);
      if (!isCurrent()) return false;
      filePreviewRequests.invalidate();
      const current = filePreviewRef.current;
      if (current?.projectId === projectId && isWorkspaceEntryWithin(current.path, entryPath)) {
        setFilePreview(null);
        setFileFocusRequest(null);
      }
      onEntryDeleted?.(entryPath);
      return true;
    } catch (error) {
      if (isCurrent()) toast.error(t('workspace.files.deleteFailed', { error: runtimeClientErrorMessage(error) }));
      return false;
    }
  })) ?? false, [client, confirm, fileDraft, filePreviewRequests, onEntryDeleted, runEntryMutation, t, toast]);

  return {
    // Effects clear project-bound state after commit; derive visibility now so a switch never renders the previous file.
    filePreview: visibleWorkspaceFilePreview(filePreview, activeProjectId),
    fileFocusRequest,
    fileDraft,
    entryOperationPending,
    createEntry,
    renameEntry,
    moveEntry,
    deleteEntry,
    openEntry,
    openProjectFile,
    cancelFilePreviewRequests: filePreviewRequests.invalidate,
    refreshFilePreview,
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

export function workspaceFileOpenFailureFeedback(
  filePath: string,
  error: unknown,
  t: Translate,
): { message: string; tone: 'error' | 'warning' } {
  const errorMessage = runtimeClientErrorMessage(error);
  if (/\bENOENT\b|\bnot found\b|no such file or directory/iu.test(errorMessage)) {
    return {
      message: t('workspace.files.openMissing', { path: filePath }),
      tone: 'warning',
    };
  }
  return {
    message: t('workspace.files.openFailed', { error: errorMessage, path: filePath }),
    tone: 'error',
  };
}

export type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>;
