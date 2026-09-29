import type { CreateThreadInput, WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, Dropdown, Popover, TextField } from '@setsuna-desktop/renderer-ui';
import { Check, FolderClosed, Laptop, Plus, Search, Split, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export type ChatStarterProjectSelection = {
  projects: WorkspaceProject[];
  onSelectProject(projectId: string | null): Promise<void>;
  onCreateProject(): void;
};

export type ChatStarterLocationSelection = {
  value: NonNullable<CreateThreadInput['workspaceMode']>;
  canCreateWorktree: boolean;
  disabled: boolean;
  onChange(value: NonNullable<CreateThreadInput['workspaceMode']>): void;
};

export function ChatStarterWorkspace({ activeProject, projects, children, locationSelection, onSelectProject, onCreateProject }: ChatStarterProjectSelection & {
  activeProject?: WorkspaceProject;
  children?: ReactNode;
  locationSelection?: ChatStarterLocationSelection;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = query.trim().toLocaleLowerCase();
  const matches = projects.filter((project) => !search || `${project.name}\n${project.path ?? ''}`.toLocaleLowerCase().includes(search));

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setError(null);
    }
  };
  const selectProject = async (projectId: string | null) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSelectProject(projectId);
      changeOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return <div className="chat-starter-workspace">
    <Popover open={open} onOpenChange={changeOpen} placement="topLeft" className="sd-menu-surface sd-picker" content={<>
      <label className="sd-picker__search">
        <Search size={14} aria-hidden="true" />
        <TextField value={query} aria-label={t('chat.starter.searchProjects')} placeholder={t('chat.starter.searchProjects')} onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <div className="sd-picker__list">
        {matches.map((project) => <Button
          key={project.id} variant="ghost" className="sd-picker__item"
          disabled={pending} title={project.path} aria-current={project.id === activeProject?.id ? 'true' : undefined}
          onClick={() => void selectProject(project.id)}
        >
          <FolderClosed size={14} aria-hidden="true" />
          <span>{project.name}</span>
          {project.id === activeProject?.id ? <Check size={14} aria-hidden="true" /> : null}
        </Button>)}
        {!matches.length ? <div className="sd-picker__empty">{t('chat.starter.noMatchingProjects')}</div> : null}
      </div>
      <div className="sd-picker__actions">
        <Button variant="ghost" className="sd-picker__item" disabled={pending} onClick={() => { changeOpen(false); onCreateProject(); }}>
          <Plus size={14} aria-hidden="true" /><span>{t('sidebar.createProject')}</span>
        </Button>
        <Button variant="ghost" className="sd-picker__item" disabled={pending} aria-current={!activeProject ? 'true' : undefined} onClick={() => void selectProject(null)}>
          <X size={14} aria-hidden="true" /><span>{t('chat.starter.noProject')}</span>
          {!activeProject ? <Check size={14} aria-hidden="true" /> : null}
        </Button>
      </div>
      {error ? <div className="sd-picker__error" role="alert">{error}</div> : null}
    </>}>
      <Button variant="ghost" className="chat-starter-workspace__project sd-picker-trigger" aria-label={t('chat.starter.switchProject')} title={activeProject?.path} disabled={pending}>
        <FolderClosed size={14} aria-hidden="true" />
        <span>{activeProject?.name ?? t('chat.starter.noProject')}</span>
      </Button>
    </Popover>
    {locationSelection ? <ChatStarterLocation {...locationSelection} /> : null}
    {children}
  </div>;
}

function ChatStarterLocation({ value, canCreateWorktree, disabled, onChange }: ChatStarterLocationSelection) {
  const { t } = useI18n();
  return <Dropdown
    disabled={disabled}
    placement="topLeft"
    menu={{ selectedKeys: [value], items: [{
      type: 'group', label: t('chat.starter.location'), children: [
        { key: 'local', label: t('chat.starter.local'), icon: <Laptop size={14} />,
          onClick: () => onChange('local') },
        { key: 'worktree', label: t('chat.starter.newWorktree'), icon: <Split size={14} />,
          disabled: !canCreateWorktree,
          tooltip: canCreateWorktree ? undefined : t('chat.fork.requiresGit'),
          onClick: () => onChange('worktree') },
      ],
    }] }}
  >
    <Button variant="ghost" className="sd-picker-trigger" disabled={disabled} aria-label={t('chat.starter.location')}>
      {value === 'worktree' ? <Split size={14} aria-hidden="true" /> : <Laptop size={14} aria-hidden="true" />}
      <span>{t(value === 'worktree' ? 'chat.starter.newWorktree' : 'chat.starter.local')}</span>
    </Button>
  </Dropdown>;
}
