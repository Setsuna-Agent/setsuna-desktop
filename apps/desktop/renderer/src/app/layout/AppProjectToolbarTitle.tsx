import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Archive, FolderClosed, MoreHorizontal } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../shared/ui/EditIcon.js';
import { SidebarFloatingMenu } from '../sidebar/SidebarFloatingMenu.js';

export function AppProjectToolbarTitle({
  project,
  title,
  onArchiveProject,
  onRenameThread,
}: {
  project: WorkspaceProject;
  title: ReactNode;
  onArchiveProject: (project: WorkspaceProject) => void;
  onRenameThread?: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const renameThread = () => {
    closeMenu();
    onRenameThread?.();
  };
  const archiveProject = () => {
    closeMenu();
    const confirmed = window.confirm(t('sidebar.archiveProjectTitle', { project: project.name }));
    if (confirmed) onArchiveProject(project);
  };

  return (
    <span className="app-project-toolbar-title" title={project.path ?? project.name}>
      <FolderClosed className="app-project-toolbar-title__project-icon" size={15} aria-hidden="true" />
      <span className="app-project-toolbar-title__label">{title}</span>
      <button
        className="app-project-toolbar-title__more"
        ref={triggerRef}
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t('sidebar.projectActions')}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      <SidebarFloatingMenu
        open={menuOpen}
        placement="bottom-right"
        triggerRef={triggerRef}
        onClose={closeMenu}
      >
        {onRenameThread ? (
          <button type="button" role="menuitem" onClick={renameThread}>
            <EditIcon size={13} />
            <span>{t('sidebar.rename')}</span>
          </button>
        ) : null}
        <button type="button" role="menuitem" onClick={archiveProject}>
          <Archive size={13} aria-hidden="true" />
          <span>{t('sidebar.archiveProject')}</span>
        </button>
      </SidebarFloatingMenu>
    </span>
  );
}
