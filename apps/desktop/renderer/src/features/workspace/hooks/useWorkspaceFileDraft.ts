import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  workspaceTarget,
  workspaceFileKey,
  type DesktopRuntimeClient,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { isWorkspaceEntryWithin, renamedWorkspaceEntryPath } from '../workspaceEntryPaths.js';

type WorkspaceFileDraftOptions = {
  client: Pick<DesktopRuntimeClient, 'readProjectFileForEdit' | 'saveProjectFile'>;
  file: WorkspaceFileRead | null;
  isSaveBlocked?: () => boolean;
  onFilePrepared: (file: WorkspaceFileRead) => void;
  onFileSaved: (file: WorkspaceFileRead) => void;
  onBackgroundFileSaved?: (file: WorkspaceFileRead) => void;
};

type WorkspaceFileDraftTarget = Pick<WorkspaceFileRead, 'projectId' | 'rootId' | 'path'>;

type WorkspaceFileDraftSession = {
  content: string;
  error: string | null;
  expectedRevision: string;
  file: WorkspaceFileDraftTarget;
  originalContent: string;
  saving: boolean;
};

export function useWorkspaceFileDraft({
  client,
  file,
  isSaveBlocked,
  onFilePrepared,
  onFileSaved,
  onBackgroundFileSaved,
}: WorkspaceFileDraftOptions) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<Record<string, WorkspaceFileDraftSession>>({});
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparingFileKey, setPreparingFileKey] = useState<string | null>(null);
  const fileKey = file ? workspaceFileKey(file) : null;
  const currentFileKeyRef = useRef(fileKey);
  const previousFileKeyRef = useRef(fileKey);
  const editRequestRef = useRef<object | null>(null);
  const saveRequestRef = useRef<{ file: WorkspaceFileDraftTarget } | null>(null);
  currentFileKeyRef.current = fileKey;
  const activeSession = fileKey ? sessions[fileKey] ?? null : null;
  const updateSession = useCallback((key: string | null, value: WorkspaceFileDraftSession | null | ((current: WorkspaceFileDraftSession | null) => WorkspaceFileDraftSession | null)) => {
    if (!key) return;
    setSessions((current) => {
      const previous = current[key] ?? null;
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) return current;
      const result = { ...current };
      if (next) result[workspaceFileKey(next.file)] = next;
      if (!next || workspaceFileKey(next.file) !== key) delete result[key];
      return result;
    });
  }, []);
  const setSession = useCallback((value: WorkspaceFileDraftSession | null | ((current: WorkspaceFileDraftSession | null) => WorkspaceFileDraftSession | null)) => {
    updateSession(currentFileKeyRef.current, value);
  }, [updateSession]);
  const hasUnsavedChanges = Object.values(sessions).some((item) => item.content !== item.originalContent);
  const isFileDirty = useCallback((target: Pick<WorkspaceFileRead, 'projectId' | 'rootId' | 'path'>) => {
    const draft = sessions[workspaceFileKey(target)];
    return Boolean(draft && draft.content !== draft.originalContent);
  }, [sessions]);
  const hasDirtyEntry = useCallback((target: WorkspaceFileDraftTarget) => Object.values(sessions)
    .some((draft) => isDraftWithinEntry(draft.file, target) && draft.content !== draft.originalContent), [sessions]);
  const editing = Boolean(activeSession);
  const dirty = Boolean(activeSession && activeSession.content !== activeSession.originalContent);
  const canEdit = canEditWorkspaceFile(file);
  const preparing = fileKey !== null && preparingFileKey === fileKey;

  useEffect(() => {
    if (previousFileKeyRef.current === fileKey) return;
    previousFileKeyRef.current = fileKey;
    editRequestRef.current = null;
    setPrepareError(null);
    setPreparingFileKey(null);
  }, [fileKey]);

  useEffect(() => () => {
    editRequestRef.current = null;
    saveRequestRef.current = null;
  }, []);

  useEffect(() => {
    if (!file) return;
    setSession((current) => {
      if (!current || workspaceFileKey(current.file) !== fileKey || current.saving
        || current.content !== current.originalContent || current.expectedRevision === file.revision) return current;
      // External changes update a clean editor in place; local edits keep their original revision for conflict checks.
      return isCompleteEditableWorkspaceFile(file) ? {
        ...current, content: file.content, originalContent: file.content, expectedRevision: file.revision, error: null,
      } : null;
    });
  }, [file, fileKey, setSession]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const preventCloseWithUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventCloseWithUnsavedChanges);
    return () => window.removeEventListener('beforeunload', preventCloseWithUnsavedChanges);
  }, [hasUnsavedChanges]);

  const prepareEditing = useCallback(async (): Promise<void> => {
    if (!file || !canEditWorkspaceFile(file) || editRequestRef.current) return;
    const editingFileKey = workspaceFileKey(file);
    const editRequest = {};
    editRequestRef.current = editRequest;
    setPrepareError(null);
    setPreparingFileKey(editingFileKey);
    try {
      const editableFile = file.truncated
        ? await client.readProjectFileForEdit(workspaceTarget(file.projectId, file.rootId), file.path)
        : file;
      if (editRequestRef.current !== editRequest || currentFileKeyRef.current !== editingFileKey) return;
      if (!isCompleteEditableWorkspaceFile(editableFile)) {
        throw new Error(t('workspace.files.editUnavailable'));
      }
      editRequestRef.current = null;
      setPreparingFileKey(null);
      if (editableFile !== file) onFilePrepared(editableFile);
      setSession({
        content: editableFile.content,
        error: null,
        expectedRevision: editableFile.revision,
        file: { projectId: editableFile.projectId, rootId: editableFile.rootId, path: editableFile.path },
        originalContent: editableFile.content,
        saving: false,
      });
    } catch (error) {
      if (editRequestRef.current !== editRequest || currentFileKeyRef.current !== editingFileKey) return;
      editRequestRef.current = null;
      setPreparingFileKey(null);
      setPrepareError(error instanceof Error ? error.message : String(error));
    }
  }, [client, file, onFilePrepared, setSession, t]);

  useEffect(() => {
    if (canEdit && !editing && !preparing && !prepareError) void prepareEditing();
  }, [canEdit, editing, preparing, prepareError, prepareEditing]);

  const updateContent = useCallback((content: string) => {
    setSession((current) => current ? { ...current, content, error: null } : current);
  }, [setSession]);

  // Mutations also check the request ref, because React may not have rendered saving=true yet.
  const isSaving = useCallback((target?: WorkspaceFileDraftTarget) => {
    const request = saveRequestRef.current;
    return Boolean(request && (!target || isDraftWithinEntry(request.file, target)));
  }, []);

  const relocateEntry = useCallback((target: WorkspaceFileDraftTarget, nextPath: string) => {
    if (file && isDraftWithinEntry(file, target)) {
      const nextKey = workspaceFileKey({ ...file, path: renamedWorkspaceEntryPath(file.path, target.path, nextPath) });
      editRequestRef.current = null;
      currentFileKeyRef.current = nextKey;
      previousFileKeyRef.current = nextKey;
      setPrepareError(null);
      setPreparingFileKey(null);
    }
    // Rename every open descendant in this directory, including drafts in inactive tabs.
    // Only identity changes: content and the saved revision remain valid at the new path.
    setSessions((current) => {
      const next = { ...current };
      for (const [key, draft] of Object.entries(current)) {
        if (!isDraftWithinEntry(draft.file, target)) continue;
        const nextFile = { ...draft.file, path: renamedWorkspaceEntryPath(draft.file.path, target.path, nextPath) };
        delete next[key];
        next[workspaceFileKey(nextFile)] = { ...draft, file: nextFile };
      }
      return next;
    });
  }, [file]);

  const discardEntry = useCallback((target: WorkspaceFileDraftTarget) => {
    if (file && isDraftWithinEntry(file, target)) {
      editRequestRef.current = null;
      setPrepareError(null);
      setPreparingFileKey(null);
    }
    setSessions((current) => Object.fromEntries(Object.entries(current)
      .filter(([, draft]) => !isDraftWithinEntry(draft.file, target))));
  }, [file]);

  const confirmDiscardChanges = useCallback(async (target?: Pick<WorkspaceFileRead, 'path' | 'projectId' | 'rootId'>): Promise<boolean> => {
    if (saveRequestRef.current) return false;
    const key = target ? workspaceFileKey(target) : fileKey;
    const draft = key ? sessions[key] : null;
    if (draft && draft.content !== draft.originalContent
      && !await confirm({ title: t('workspace.files.unsavedConfirm'), danger: true })) return false;
    if (!target && currentFileKeyRef.current !== key) return false;
    if (key === currentFileKeyRef.current) {
      editRequestRef.current = null;
      setPrepareError(null);
      setPreparingFileKey(null);
    }
    updateSession(key, null);
    return true;
  }, [confirm, fileKey, sessions, t, updateSession]);

  const confirmDiscardAllChanges = useCallback(async (): Promise<boolean> => {
    if (saveRequestRef.current) return false;
    if (hasUnsavedChanges && !await confirm({ title: t('workspace.files.unsavedConfirm'), danger: true })) return false;
    editRequestRef.current = null;
    saveRequestRef.current = null;
    setSessions({});
    setPrepareError(null);
    setPreparingFileKey(null);
    return true;
  }, [confirm, hasUnsavedChanges, t]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!file || !activeSession || activeSession.saving || saveRequestRef.current
      || isSaveBlocked?.() || currentFileKeyRef.current !== workspaceFileKey(activeSession.file)) return false;
    if (!dirty) return true;
    const savingFileKey = workspaceFileKey(activeSession.file);
    const savingContent = activeSession.content;
    const saveRequest = { file: activeSession.file };
    saveRequestRef.current = saveRequest;
    setSession((current) => current && workspaceFileKey(current.file) === savingFileKey
      ? { ...current, error: null, saving: true }
      : current);
    try {
      const saved = await client.saveProjectFile(workspaceTarget(file.projectId, file.rootId), file.path, {
        content: savingContent,
        expectedRevision: activeSession.expectedRevision,
      });
      if (saveRequestRef.current !== saveRequest) return true;
      saveRequestRef.current = null;
      if (currentFileKeyRef.current === savingFileKey) onFileSaved(saved);
      else onBackgroundFileSaved?.(saved);
      updateSession(savingFileKey, (current) => reconcileWorkspaceFileDraftAfterSave(current, {
        saved, savingContent, savingFileKey,
      }));
      return true;
    } catch (error) {
      if (saveRequestRef.current !== saveRequest) return false;
      saveRequestRef.current = null;
      updateSession(savingFileKey, (current) => current && workspaceFileKey(current.file) === savingFileKey ? {
        ...current,
        error: error instanceof Error ? error.message : String(error),
        saving: false,
      } : current);
      return false;
    }
  }, [activeSession, client, dirty, file, isSaveBlocked, onFileSaved, onBackgroundFileSaved, setSession, updateSession]);

  const saveError = activeSession?.error ?? null;
  const error = prepareError ?? saveError;
  const errorMessage = prepareError
    ? t('workspace.files.loadForEditFailed', { error: prepareError })
    : saveError
      ? t('workspace.files.saveFailed', { error: saveError })
      : null;

  return useMemo(() => ({
    canEdit,
    confirmDiscardChanges,
    confirmDiscardAllChanges,
    hasUnsavedChanges,
    hasDirtyEntry,
    isFileDirty,
    discardEntry,
    content: activeSession?.content ?? file?.content ?? '',
    dirty,
    editing,
    error,
    errorMessage,
    isSaving,
    preparing,
    relocateEntry,
    save,
    saving: activeSession?.saving ?? false,
    updateContent,
  }), [
    activeSession,
    canEdit,
    confirmDiscardChanges,
    confirmDiscardAllChanges,
    hasUnsavedChanges,
    hasDirtyEntry,
    isFileDirty,
    discardEntry,
    dirty,
    editing,
    error,
    errorMessage,
    isSaving,
    file?.content,
    preparing,
    relocateEntry,
    save,
    updateContent,
  ]);
}

export function canEditWorkspaceFile(file: WorkspaceFileRead | null): file is WorkspaceFileRead & { revision: string } {
  return Boolean(
    file
    && file.preview?.kind === 'text'
    && file.size <= WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES
    && file.revision,
  );
}

function isCompleteEditableWorkspaceFile(
  file: WorkspaceFileRead,
): file is WorkspaceFileRead & { revision: string } {
  return canEditWorkspaceFile(file) && !file.truncated;
}


export function reconcileWorkspaceFileDraftAfterSave(
  current: WorkspaceFileDraftSession | null,
  {
    saved,
    savingContent,
    savingFileKey,
  }: {
    saved: WorkspaceFileRead;
    savingContent: string;
    savingFileKey: string;
  },
): WorkspaceFileDraftSession | null {
  if (!current || workspaceFileKey(current.file) !== savingFileKey) return current;
  // Keep the editor mounted after saving, including any input made while the
  // write was pending. The next save uses the revision that just landed.
  return {
    ...current,
    content: current.content === savingContent ? saved.content : current.content,
    error: null,
    expectedRevision: saved.revision ?? current.expectedRevision,
    originalContent: saved.content,
    saving: false,
  };
}

export type WorkspaceFileDraftState = ReturnType<typeof useWorkspaceFileDraft>;

function isDraftWithinEntry(file: WorkspaceFileDraftTarget, entry: WorkspaceFileDraftTarget): boolean {
  return file.projectId === entry.projectId && file.rootId === entry.rootId
    && isWorkspaceEntryWithin(file.path, entry.path);
}
