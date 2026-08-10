import {
  WORKSPACE_PROJECT_NAME_MAX_CHARS,
  type UpdateWorkspaceProjectInput,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { Folder, FolderPlus, Link2Off, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton, TextField } from '../../shared/ui/primitives.js';

type ProjectEditorDialogProps = {
  project: WorkspaceProject | null;
  onClose: () => void;
  onRemove: (project: WorkspaceProject) => Promise<boolean>;
  onSave: (input: UpdateWorkspaceProjectInput) => Promise<boolean>;
};

export function ProjectEditorDialog({
  project,
  onClose,
  onRemove,
  onSave,
}: ProjectEditorDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );
  const [name, setName] = useState(project?.name ?? '');
  const [directoryPath, setDirectoryPath] = useState<string | undefined>(project?.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  const chooseDirectory = async () => {
    const selectDirectory = window.setsunaDesktop?.desktop?.selectDirectory;
    if (!selectDirectory) {
      setError(t('sidebar.directoryPickerUnavailable'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selectedPath = await selectDirectory({ title: t('sidebar.projectDirectoryPickerTitle') });
      if (!selectedPath) return;
      setDirectoryPath(selectedPath);
      setName((current) => current.trim() ? current : directoryName(selectedPath));
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave({ name: name.trim(), path: directoryPath ?? null });
      if (saved) onClose();
      else setBusy(false);
    } catch (unknownError) {
      setError(errorMessage(unknownError));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!project || busy || !window.confirm(t('sidebar.removeProjectTitle', { project: project.name }))) return;
    setBusy(true);
    setError(null);
    try {
      const removed = await onRemove(project);
      if (removed) onClose();
      else setBusy(false);
    } catch (unknownError) {
      setError(errorMessage(unknownError));
      setBusy(false);
    }
  };

  const dialog = (
    <div
      className="desktop-agent-modal-backdrop desktop-project-editor-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="desktop-agent-modal desktop-project-editor"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <header className="desktop-project-editor__header">
          <div>
            <strong id={titleId}>
              {t(project ? 'sidebar.editProject' : 'sidebar.createProject')}
            </strong>
            <small id={descriptionId}>{t('sidebar.projectEditorDescription')}</small>
          </div>
          <IconButton label={t('common.close')} disabled={busy} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        <div className="desktop-project-editor__body">
          <label className="desktop-project-editor__field">
            <span>{t('sidebar.projectName')}</span>
            <span className="desktop-project-editor__name-input">
              <Folder size={14} aria-hidden="true" />
              <TextField
                autoFocus
                disabled={busy}
                maxLength={WORKSPACE_PROJECT_NAME_MAX_CHARS}
                required
                value={name}
                placeholder={t('sidebar.projectNamePlaceholder')}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </span>
          </label>

          <div className="desktop-project-editor__field">
            <span>{t('sidebar.projectDirectory')}</span>
            <div className="desktop-project-editor__directory">
              {directoryPath ? (
                <div className="desktop-project-editor__directory-row">
                  <Folder size={15} aria-hidden="true" />
                  <span title={directoryPath}>{directoryPath}</span>
                  <IconButton
                    label={t('sidebar.unbindProjectDirectory')}
                    disabled={busy}
                    onClick={() => setDirectoryPath(undefined)}
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ) : (
                <div className="desktop-project-editor__directory-empty">
                  <Link2Off size={15} aria-hidden="true" />
                  <span>{t('sidebar.projectDirectoryUnbound')}</span>
                </div>
              )}
              <button
                className="desktop-project-editor__choose-directory"
                type="button"
                disabled={busy}
                onClick={() => void chooseDirectory()}
              >
                <FolderPlus size={15} aria-hidden="true" />
                <span>{t(directoryPath ? 'sidebar.changeProjectDirectory' : 'sidebar.bindProjectDirectory')}</span>
              </button>
            </div>
          </div>

          {error ? <div className="desktop-project-editor__error" role="alert">{error}</div> : null}
        </div>

        <footer className="desktop-project-editor__footer">
          <span>
            {project ? (
              <Button disabled={busy} type="button" variant="danger" onClick={() => void remove()}>
                {t('sidebar.removeProject')}
              </Button>
            ) : null}
          </span>
          <span>
            <Button disabled={busy} type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy || !name.trim()} type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </span>
        </footer>
      </form>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function directoryName(directoryPath: string): string {
  return directoryPath.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1) ?? directoryPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
