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

type WorkspaceFileDraftOptions = {
  client: Pick<DesktopRuntimeClient, 'readProjectFileForEdit' | 'saveProjectFile'>;
  file: WorkspaceFileRead | null;
  isSaveBlocked?: () => boolean;
  onFilePrepared: (file: WorkspaceFileRead) => void;
  onFileSaved: (file: WorkspaceFileRead) => void;
  onBackgroundFileSaved?: (file: WorkspaceFileRead) => void;
};

type WorkspaceFileDraftSession = {
  content: string;
  error: string | null;
  expectedRevision: string;
  fileKey: string;
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
  const saveRequestRef = useRef<object | null>(null);
  currentFileKeyRef.current = fileKey;
  const activeSession = fileKey ? sessions[fileKey] ?? null : null;
  const updateSession = useCallback((key: string | null, value: WorkspaceFileDraftSession | null | ((current: WorkspaceFileDraftSession | null) => WorkspaceFileDraftSession | null)) => {
    if (!key) return;
    setSessions((current) => {
      const previous = current[key] ?? null;
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) return current;
      const result = { ...current };
      if (next) result[next.fileKey] = next;
      if (!next || next.fileKey !== key) delete result[key];
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
      if (!current || current.fileKey !== fileKey || current.saving
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
        fileKey: editingFileKey,
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
  const isSaving = useCallback(() => saveRequestRef.current !== null, []);

  const relocateFile = useCallback((nextFile: WorkspaceFileRead) => {
    const previousKey = currentFileKeyRef.current;
    const nextKey = workspaceFileKey(nextFile);
    editRequestRef.current = null;
    currentFileKeyRef.current = nextKey;
    previousFileKeyRef.current = nextKey;
    setPrepareError(null);
    setPreparingFileKey(null);
    // A filesystem rename changes identity, not the document or its saved revision.
    updateSession(previousKey, (current) => current ? { ...current, fileKey: nextKey } : current);
  }, [updateSession]);

  const discardFile = useCallback((target: Pick<WorkspaceFileRead, 'path' | 'projectId' | 'rootId'>) => {
    const key = workspaceFileKey(target);
    if (key === currentFileKeyRef.current) {
      editRequestRef.current = null;
      setPrepareError(null);
      setPreparingFileKey(null);
    }
    updateSession(key, null);
  }, [updateSession]);

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
      || isSaveBlocked?.() || currentFileKeyRef.current !== activeSession.fileKey) return false;
    if (!dirty) return true;
    const savingFileKey = activeSession.fileKey;
    const savingContent = activeSession.content;
    const saveRequest = {};
    saveRequestRef.current = saveRequest;
    setSession((current) => current?.fileKey === savingFileKey
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
      updateSession(savingFileKey, (current) => current?.fileKey === savingFileKey ? {
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
    isFileDirty,
    discardFile,
    content: activeSession?.content ?? file?.content ?? '',
    dirty,
    editing,
    error,
    errorMessage,
    isSaving,
    preparing,
    relocateFile,
    save,
    saving: activeSession?.saving ?? false,
    updateContent,
  }), [
    activeSession,
    canEdit,
    confirmDiscardChanges,
    confirmDiscardAllChanges,
    hasUnsavedChanges,
    isFileDirty,
    discardFile,
    dirty,
    editing,
    error,
    errorMessage,
    isSaving,
    file?.content,
    preparing,
    relocateFile,
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
  if (!current || current.fileKey !== savingFileKey) return current;
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
