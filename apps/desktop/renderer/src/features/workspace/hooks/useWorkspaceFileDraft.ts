import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type DesktopRuntimeClient,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

type WorkspaceFileDraftOptions = {
  client: Pick<DesktopRuntimeClient, 'readProjectFileForEdit' | 'saveProjectFile'>;
  file: WorkspaceFileRead | null;
  onFilePrepared: (file: WorkspaceFileRead) => void;
  onFileSaved: (file: WorkspaceFileRead) => void;
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
  onFilePrepared,
  onFileSaved,
}: WorkspaceFileDraftOptions) {
  const { t } = useI18n();
  const [session, setSession] = useState<WorkspaceFileDraftSession | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparingFileKey, setPreparingFileKey] = useState<string | null>(null);
  const fileKey = file ? workspaceFileKey(file) : null;
  const currentFileKeyRef = useRef(fileKey);
  const previousFileKeyRef = useRef(fileKey);
  const editRequestRef = useRef<object | null>(null);
  const saveRequestRef = useRef<object | null>(null);
  currentFileKeyRef.current = fileKey;
  const activeSession = session?.fileKey === fileKey ? session : null;
  const editing = Boolean(activeSession);
  const dirty = Boolean(activeSession && activeSession.content !== activeSession.originalContent);
  const canEdit = canEditWorkspaceFile(file);
  const preparing = preparingFileKey === fileKey;

  useEffect(() => {
    if (previousFileKeyRef.current === fileKey) return;
    previousFileKeyRef.current = fileKey;
    editRequestRef.current = null;
    saveRequestRef.current = null;
    setPrepareError(null);
    setPreparingFileKey(null);
    setSession(null);
  }, [fileKey]);

  useEffect(() => {
    if (!dirty) return undefined;
    const preventCloseWithUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventCloseWithUnsavedChanges);
    return () => window.removeEventListener('beforeunload', preventCloseWithUnsavedChanges);
  }, [dirty]);

  const startEditing = useCallback(async (): Promise<void> => {
    if (!file || !canEditWorkspaceFile(file) || editRequestRef.current) return;
    const editingFileKey = workspaceFileKey(file);
    const editRequest = {};
    editRequestRef.current = editRequest;
    saveRequestRef.current = null;
    setPrepareError(null);
    setPreparingFileKey(editingFileKey);
    try {
      const editableFile = file.truncated
        ? await client.readProjectFileForEdit(file.projectId, file.path)
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
  }, [client, file, onFilePrepared, t]);

  const updateContent = useCallback((content: string) => {
    setSession((current) => current ? { ...current, content, error: null } : current);
  }, []);

  const confirmDiscardChanges = useCallback((): boolean => {
    if (!dirty) {
      editRequestRef.current = null;
      setPrepareError(null);
      setPreparingFileKey(null);
      if (editing) {
        saveRequestRef.current = null;
        setSession(null);
      }
      return true;
    }
    if (!window.confirm(t('workspace.files.unsavedConfirm'))) return false;
    editRequestRef.current = null;
    saveRequestRef.current = null;
    setPrepareError(null);
    setPreparingFileKey(null);
    setSession(null);
    return true;
  }, [dirty, editing, t]);

  const cancelEditing = useCallback(() => {
    confirmDiscardChanges();
  }, [confirmDiscardChanges]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!file || !activeSession || activeSession.saving) return false;
    const savingFileKey = activeSession.fileKey;
    const savingContent = activeSession.content;
    const saveRequest = {};
    saveRequestRef.current = saveRequest;
    setSession((current) => current?.fileKey === savingFileKey
      ? { ...current, error: null, saving: true }
      : current);
    try {
      const saved = await client.saveProjectFile(file.projectId, file.path, {
        content: savingContent,
        expectedRevision: activeSession.expectedRevision,
      });
      // Navigation may have discarded this draft while the write was pending.
      // Never let a stale response replace the file that is currently visible.
      if (saveRequestRef.current !== saveRequest || currentFileKeyRef.current !== savingFileKey) {
        if (saveRequestRef.current === saveRequest) saveRequestRef.current = null;
        return true;
      }
      saveRequestRef.current = null;
      onFileSaved(saved);
      setSession((current) => reconcileWorkspaceFileDraftAfterSave(current, {
        saved,
        savingContent,
        savingFileKey,
      }));
      return true;
    } catch (error) {
      if (saveRequestRef.current !== saveRequest || currentFileKeyRef.current !== savingFileKey) {
        if (saveRequestRef.current === saveRequest) saveRequestRef.current = null;
        return false;
      }
      saveRequestRef.current = null;
      setSession((current) => current?.fileKey === savingFileKey ? {
        ...current,
        error: error instanceof Error ? error.message : String(error),
        saving: false,
      } : current);
      return false;
    }
  }, [activeSession, client, file, onFileSaved]);

  const saveError = activeSession?.error ?? null;
  const error = prepareError ?? saveError;
  const errorMessage = prepareError
    ? t('workspace.files.loadForEditFailed', { error: prepareError })
    : saveError
      ? t('workspace.files.saveFailed', { error: saveError })
      : null;

  return useMemo(() => ({
    canEdit,
    cancelEditing,
    confirmDiscardChanges,
    content: activeSession?.content ?? file?.content ?? '',
    dirty,
    editing,
    error,
    errorMessage,
    preparing,
    save,
    saving: activeSession?.saving ?? false,
    startEditing,
    updateContent,
  }), [
    activeSession,
    canEdit,
    cancelEditing,
    confirmDiscardChanges,
    dirty,
    editing,
    error,
    errorMessage,
    file?.content,
    preparing,
    save,
    startEditing,
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

function workspaceFileKey(file: Pick<WorkspaceFileRead, 'path' | 'projectId'>): string {
  return `${file.projectId}:${file.path}`;
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
  if (current.content === savingContent || current.content === saved.content) return null;

  // The persisted snapshot succeeded, but the editor has moved on. Keep those
  // newer edits and rebase the next save onto the revision that just landed.
  return {
    ...current,
    error: null,
    expectedRevision: saved.revision ?? current.expectedRevision,
    originalContent: saved.content,
    saving: false,
  };
}

export type WorkspaceFileDraftState = ReturnType<typeof useWorkspaceFileDraft>;
