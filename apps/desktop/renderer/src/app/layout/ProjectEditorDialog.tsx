import { Button as UiButton, ConfirmDialogTrigger, Dialog } from '@setsuna-desktop/renderer-ui';
import {
  WORKSPACE_PROJECT_NAME_MAX_CHARS,
  type UpdateWorkspaceProjectInput,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { Folder, FolderPlus, Link2Off, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
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
  const formId = useId();
  const [name, setName] = useState(project?.name ?? '');
  const [directoryPath, setDirectoryPath] = useState<string | undefined>(project?.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!project || busy) return;
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

  const footer = (
    <div className="desktop-project-editor__footer">
      <span>
        {project ? (
          <ConfirmDialogTrigger title={t('sidebar.removeProjectTitle', { project: project.name })}
            confirmLabel={t('sidebar.removeProject')} cancelLabel={t('common.cancel')}
            danger disabled={busy} onConfirm={remove}>
            <Button disabled={busy} variant="danger">{t('sidebar.removeProject')}</Button>
          </ConfirmDialogTrigger>
        ) : null}
      </span>
      <span>
        <Button disabled={busy} type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button disabled={busy || !name.trim()} form={formId} type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </span>
    </div>
  );

  return (
    <Dialog title={t(project ? 'sidebar.editProject' : 'sidebar.createProject')}
      description={t('sidebar.projectEditorDescription')} className="desktop-project-editor"
      width={520} footer={footer} dismissible={!busy} onClose={onClose}>
      <form id={formId} aria-busy={busy} onSubmit={(event) => void submit(event)}>
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
              <UiButton variant="ghost"
                className="desktop-project-editor__choose-directory"
                type="button"
                disabled={busy}
                onClick={() => void chooseDirectory()}
              >
                <FolderPlus size={15} aria-hidden="true" />
                <span>{t(directoryPath ? 'sidebar.changeProjectDirectory' : 'sidebar.bindProjectDirectory')}</span>
              </UiButton>
            </div>
          </div>

          {error ? <div className="desktop-project-editor__error" role="alert">{error}</div> : null}
        </div>
      </form>
    </Dialog>
  );
}

function directoryName(directoryPath: string): string {
  return directoryPath.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1) ?? directoryPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
