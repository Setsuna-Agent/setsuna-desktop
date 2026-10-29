import { ToastNotice, Button as UiButton, ConfirmDialogTrigger, Dialog } from '@setsuna-desktop/renderer-ui';
import {
  WORKSPACE_PROJECT_NAME_MAX_CHARS,
  canFollowWorkspaceConversationDefaults,
  workspaceProjectRoots,
  workspaceRootName,
  type WorkspaceProjectRoot,
  type UpdateWorkspaceProjectInput,
  type WorkspaceProject,
  type WorkspaceProjectIcon,
  type WorkspaceConversationDefaults,
} from '@setsuna-desktop/contracts';
import { Folder, FolderPlus, Star, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton, TextField } from '../../shared/ui/primitives.js';
import { ProjectConversationDefaultsFields } from './project-defaults/ProjectConversationDefaultsFields.js';
import { ProjectIconPicker } from './ProjectIconPicker.js';

type ProjectEditorDialogProps = {
  project: WorkspaceProject | null;
  projects?: readonly WorkspaceProject[];
  onClose: () => void;
  onRemove: (project: WorkspaceProject) => Promise<boolean>;
  onSave: (input: UpdateWorkspaceProjectInput) => Promise<boolean>;
};

export function ProjectEditorDialog({
  project,
  projects = [],
  onClose,
  onRemove,
  onSave,
}: ProjectEditorDialogProps) {
  const { t } = useI18n();
  const formId = useId();
  const nameId = `${formId}-name`;
  const [name, setName] = useState(project?.name ?? '');
  const [icon, setIcon] = useState<WorkspaceProjectIcon | null>(project?.icon ?? null);
  const [roots, setRoots] = useState<WorkspaceProjectRoot[]>(() => workspaceProjectRoots(project));
  const [conversationDefaults, setConversationDefaults] = useState<WorkspaceConversationDefaults>(project?.conversationDefaults ?? {});
  const validDefaults = conversationDefaults.sourceProjectId === undefined
    || canFollowWorkspaceConversationDefaults(project?.id, conversationDefaults.sourceProjectId, projects);
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
      setRoots((current) => current.some((root) => root.path === selectedPath) ? current
        : [...current, { id: `root_${crypto.randomUUID().replaceAll('-', '')}`, path: selectedPath }]);
      setName((current) => current.trim() ? current : directoryName(selectedPath));
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !name.trim() || !validDefaults) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave({ name: name.trim(), roots, icon, conversationDefaults });
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
        <Button disabled={busy || !name.trim() || !validDefaults} form={formId} type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </span>
    </div>
  );

  return (
    <Dialog title={t(project ? 'sidebar.editProject' : 'sidebar.createProject')}
      className="desktop-project-editor"
      width={520} footer={footer} dismissible={!busy} onClose={onClose}>
      <form id={formId} aria-busy={busy} onSubmit={(event) => void submit(event)}>
        <div className="desktop-project-editor__body">
          <div className="desktop-project-editor__field">
            <label htmlFor={nameId}>{t('sidebar.projectName')}</label>
            <span className="desktop-project-editor__name-input">
              <ProjectIconPicker value={icon} disabled={busy} onChange={setIcon} />
              <TextField
                id={nameId}
                autoFocus
                disabled={busy}
                maxLength={WORKSPACE_PROJECT_NAME_MAX_CHARS}
                required
                value={name}
                placeholder={t('sidebar.projectNamePlaceholder')}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </span>
          </div>

          <div className="desktop-project-editor__field">
            <span>{t('sidebar.projectDirectory')}</span>
            <div className="desktop-project-editor__directory">
              {roots.map((root, index) => (
                <div className="desktop-project-editor__directory-row" key={root.id}>
                  <Folder size={15} aria-hidden="true" />
                  <span title={root.path}>{workspaceRootName(root)}</span>
                  {index === 0 ? <span className="desktop-project-editor__primary">{t('sidebar.primaryDirectory')}</span> : (
                    <IconButton label={t('sidebar.makePrimaryDirectory')} disabled={busy}
                      onClick={() => setRoots((current) => [root, ...current.filter((item) => item.id !== root.id)])}>
                      <Star size={14} />
                    </IconButton>
                  )}
                  <IconButton label={t('sidebar.unbindProjectDirectory')} disabled={busy}
                    onClick={() => setRoots((current) => current.filter((item) => item.id !== root.id))}>
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
              <UiButton variant="ghost"
                className="desktop-project-editor__choose-directory"
                type="button"
                disabled={busy}
                onClick={() => void chooseDirectory()}
              >
                <FolderPlus size={15} aria-hidden="true" />
                <span>{t('sidebar.addProjectDirectory')}</span>
              </UiButton>
            </div>
          </div>

          <ProjectConversationDefaultsFields value={conversationDefaults} projects={projects} projectId={project?.id}
            disabled={busy} onChange={setConversationDefaults} />
          {error ? <ToastNotice message={error} /> : null}
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
