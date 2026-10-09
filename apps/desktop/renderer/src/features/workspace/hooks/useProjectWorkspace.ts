import { workspaceTarget, resolveWorkspaceFileReference, type WorkspaceProject } from '@setsuna-desktop/contracts';
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
  rootId?: string;
  project?: WorkspaceProject;
  client: DesktopRuntimeClient;
  onOpenFilePanel: (filePath: string, rootId?: string) => void;
  onEntryRenamed?: (previousPath: string, nextPath: string, rootId?: string) => void;
  onEntryDeleted?: (entryPath: string, rootId?: string) => void;
};

export function useProjectWorkspace({ activeProjectId, rootId, project, client, onOpenFilePanel, onEntryRenamed, onEntryDeleted }: ProjectWorkspaceOptions) {
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
  const scopeKey = JSON.stringify([activeProjectId, rootId]);
  const previewsByScope = useRef(new Map<string, WorkspaceFileRead>());
  const previousProjectIdRef = useRef(scopeKey);
  const activeProjectIdRef = useRef(scopeKey);
  const filePreviewRequests = useLatestRequestGuard();
  const contentSearchRequests = useLatestRequestGuard();
  const entryMutationRequests = useIdentityRequestGuard(scopeKey);
  activeProjectIdRef.current = scopeKey;
  const isSaveBlocked = useCallback(() => entryOperationRef.current, []);
  const fileDraft = useWorkspaceFileDraft({
    client,
    file: filePreview,
    isSaveBlocked,
    onFilePrepared: setFilePreview,
    onFileSaved: setFilePreview,
    onBackgroundFileSaved: (file) => previewsByScope.current.set(JSON.stringify([file.projectId, file.rootId]), file),
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
    if (previousProjectIdRef.current === scopeKey) return;
    const current = filePreviewRef.current;
    if (current) previewsByScope.current.set(JSON.stringify([current.projectId, current.rootId]), current);
    previousProjectIdRef.current = scopeKey;
    resetProjectWorkspaceState();
    setFilePreview(previewsByScope.current.get(scopeKey) ?? null);
  }, [scopeKey, resetProjectWorkspaceState]);

  useEffect(() => {
    if (filePreview) previewsByScope.current.set(JSON.stringify([filePreview.projectId, filePreview.rootId]), filePreview);
  }, [filePreview]);

  const openEntry = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!activeProjectId) return;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      if (entry.type === 'directory') {
        if (!await confirmDiscardChanges()) return;
        if (!isLatest() || activeProjectIdRef.current !== scopeKey) return;
        setFilePreview(null);
        setFileFocusRequest(null);
        return;
      }
      if (filePreview?.path === entry.path && filePreview.projectId === activeProjectId && filePreview.rootId === rootId) {
        setFileFocusRequest(null);
        onOpenFilePanel(filePreview.path, filePreview.rootId);
        return;
      }
      if (!await confirmDiscardChanges()) return;
      if (!isLatest() || activeProjectIdRef.current !== scopeKey) return;
      const file = await client.readProjectFile(workspaceTarget(projectId, rootId), entry.path);
      if (!isLatest() || activeProjectIdRef.current !== scopeKey) return;
      setFilePreview(file);
      setFileFocusRequest(null);
      onOpenFilePanel(file.path, file.rootId);
    },
    [activeProjectId, rootId, scopeKey, client, confirmDiscardChanges, filePreview, filePreviewRequests, onOpenFilePanel],
  );

  const openProjectFile = useCallback(
    async (filePath: string, line?: number, selectedRootId = rootId): Promise<boolean> => {
      const reference = project ? resolveWorkspaceFileReference(project, filePath, selectedRootId) : null;
      const targetRootId = reference?.root.id ?? selectedRootId;
      filePath = reference?.path ?? filePath;
      if (!activeProjectId) return false;
      const projectId = activeProjectId;
      const isLatest = filePreviewRequests.begin();
      if (filePreview?.path === filePath && filePreview.projectId === activeProjectId && filePreview.rootId === targetRootId) {
        setFileFocusRequest((current) => createFileFocusRequest(
          filePreview.path,
          line,
          current,
        ));
        onOpenFilePanel(filePreview.path, filePreview.rootId);
        return true;
      }
      if (targetRootId === rootId && !await confirmDiscardChanges()) return false;
      if (!isLatest() || activeProjectIdRef.current !== scopeKey) return false;
      try {
        const file = await client.readProjectFile(workspaceTarget(projectId, targetRootId), filePath);
        if (!isLatest() || activeProjectIdRef.current !== scopeKey) return false;
        setFilePreview(file);
        setFileFocusRequest((current) => createFileFocusRequest(
          file.path,
          line,
          current,
        ));
        onOpenFilePanel(file.path, file.rootId);
        return true;
      } catch (error) {
        if (!isLatest() || activeProjectIdRef.current !== scopeKey) return false;
        const feedback = workspaceFileOpenFailureFeedback(filePath, error, t);
        toast[feedback.tone](feedback.message);
        return false;
      }
    },
    [activeProjectId, rootId, scopeKey, project, client, confirmDiscardChanges, filePreview, filePreviewRequests, onOpenFilePanel, t, toast],
  );

  const searchProjectEntries = useCallback(
    async (query = '', parent?: string | null): Promise<WorkspaceEntrySearchResponse> => {
      if (!activeProjectId) {
        return { entries: [], query: query.trim().toLowerCase(), scanned: 0, truncated: false, workspaceRoot: '' };
      }
      const result = await client.searchProjectEntries(workspaceTarget(activeProjectId, rootId), query, parent);
      return result;
    },
    [activeProjectId, rootId, client],
  );

  const searchProject = useCallback(async () => {
    if (!activeProjectId || !searchQuery.trim()) return;
    const projectId = activeProjectId;
    const query = searchQuery;
    const isLatest = contentSearchRequests.begin();
    const result = await client.searchProject(workspaceTarget(projectId, rootId), query);
    if (result.superseded || !isLatest() || activeProjectIdRef.current !== scopeKey) return;
    setSearchResults(result.results);
  }, [activeProjectId, rootId, scopeKey, client, contentSearchRequests, searchQuery]);

  const updateFilePreview = useCallback(async (file: WorkspaceFileRead | null): Promise<boolean> => {
    const isLatest = filePreviewRequests.begin();
    if (file?.projectId !== filePreview?.projectId || file?.path !== filePreview?.path || file?.rootId !== filePreview?.rootId) {
      if (!await confirmDiscardChanges()) return false;
    }
    if (!isLatest()) return false;
    setFilePreview(file);
    setFileFocusRequest(null);
    return true;
  }, [confirmDiscardChanges, filePreview?.path, filePreview?.projectId, filePreview?.rootId, filePreviewRequests]);

  const refreshFilePreview = useCallback(async (isCurrent: () => boolean): Promise<void> => {
    const previous = filePreviewRef.current;
    if (!previous || JSON.stringify([previous.projectId, previous.rootId]) !== activeProjectIdRef.current
      || fileDraftRef.current.dirty || fileDraftRef.current.saving) return;
    try {
      const next = await client.readProjectFile(workspaceTarget(previous.projectId, previous.rootId), previous.path);
      // A background read must not replace a newer selection, save, or local edit.
      if (!isCurrent() || filePreviewRef.current !== previous
        || activeProjectIdRef.current !== JSON.stringify([previous.projectId, previous.rootId])
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
    (projectId) => client.createProjectEntry(workspaceTarget(projectId, rootId), input),
  ), [client, rootId, runEntryMutation]);

  const relocateEntry = useCallback((entryPath: string, relocate: (projectId: string, isCurrent: () => boolean) => Promise<WorkspaceEntry | null>) => runEntryMutation(async (projectId, isCurrent) => {
    const preview = filePreviewRef.current;
    const affectsPreview = preview?.rootId === rootId && preview && isWorkspaceEntryWithin(preview.path, entryPath);
    if (affectsPreview && fileDraft.isSaving()) throw new Error(t('workspace.files.renameWhileSaving'));
    const entry = await relocate(projectId, isCurrent);
    if (!entry || !isCurrent()) return null;
    filePreviewRequests.invalidate();
    const current = filePreviewRef.current;
    if (current?.projectId === projectId && current.rootId === rootId) {
      const nextPath = renamedWorkspaceEntryPath(current.path, entryPath, entry.path);
      if (nextPath !== current.path) {
        const nextFile = { ...current, path: nextPath };
        fileDraft.relocateFile(nextFile);
        setFilePreview(nextFile);
        setFileFocusRequest((focus) => focus ? { ...focus, path: nextPath } : null);
      }
    }
    onEntryRenamed?.(entryPath, entry.path, rootId);
    return entry;
  }), [fileDraft, filePreviewRequests, onEntryRenamed, rootId, runEntryMutation, t]);

  const renameEntry = useCallback((entryPath: string, name: string) => relocateEntry(
    entryPath, (projectId) => client.renameProjectEntry(workspaceTarget(projectId, rootId), entryPath, { name }),
  ), [client, rootId, relocateEntry]);

  const moveEntry = useCallback((entryPath: string, parentPath: string) => relocateEntry(
    entryPath, async (projectId, isCurrent) => {
      const approved = await confirm({
        title: t('workspace.files.moveConfirm'),
        description: t('workspace.files.moveDescription', {
          path: entryPath, destination: parentPath || t('workspace.files.workspaceRoot'),
        }),
        confirmLabel: t('workspace.files.move'),
      });
      // Keep the mutation guard while deciding, and reject confirmations for a workspace that changed.
      if (!approved || !isCurrent()) return null;
      return client.moveProjectEntry(workspaceTarget(projectId, rootId), entryPath, { parentPath });
    },
  ), [client, rootId, confirm, relocateEntry, t]);

  const deleteEntry = useCallback(async (entryPath: string): Promise<boolean> => (await runEntryMutation(async (projectId, isCurrent) => {
    if (!entryPath) return false;
    const preview = filePreviewRef.current;
    const affectsPreview = preview?.rootId === rootId && preview && isWorkspaceEntryWithin(preview.path, entryPath);
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
      await client.deleteProjectEntry(workspaceTarget(projectId, rootId), entryPath);
      if (!isCurrent()) return false;
      filePreviewRequests.invalidate();
      const current = filePreviewRef.current;
      if (current?.projectId === projectId && current.rootId === rootId && isWorkspaceEntryWithin(current.path, entryPath)) {
        fileDraft.discardFile(current);
        previewsByScope.current.delete(JSON.stringify([projectId, rootId]));
        setFilePreview(null);
        setFileFocusRequest(null);
      }
      onEntryDeleted?.(entryPath, rootId);
      return true;
    } catch (error) {
      if (isCurrent()) toast.error(t('workspace.files.deleteFailed', { error: runtimeClientErrorMessage(error) }));
      return false;
    }
  })) ?? false, [client, confirm, fileDraft, filePreviewRequests, onEntryDeleted, rootId, runEntryMutation, t, toast]);

  const isFileDirty = useCallback((filePath: string, fileRootId?: string) => activeProjectId !== null
    && fileDraft.isFileDirty({ projectId: activeProjectId, rootId: fileRootId, path: filePath }), [activeProjectId, fileDraft.isFileDirty]);

  return {
    // Effects clear project-bound state after commit; derive visibility now so a switch never renders the previous file.
    filePreview: visibleWorkspaceFilePreview(filePreview, activeProjectId, rootId),
    fileFocusRequest,
    fileDraft,
    isFileDirty,
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
  rootId?: string,
): WorkspaceFileRead | null {
  return filePreview?.projectId === activeProjectId && filePreview.rootId === rootId ? filePreview : null;
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
