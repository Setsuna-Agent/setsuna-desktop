import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Archive, FolderClosed, MoreHorizontal } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../shared/ui/EditIcon.js';
import { SidebarFloatingMenu } from '../sidebar/SidebarFloatingMenu.js';

export function AppProjectToolbarTitle({
  project,
  title,
  archiveThreadDisabled = false,
  onArchiveThread,
  onRenameThread,
}: {
  project: WorkspaceProject;
  title: ReactNode;
  archiveThreadDisabled?: boolean;
  onArchiveThread?: () => void;
  onRenameThread?: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const hasThreadActions = Boolean(onArchiveThread || onRenameThread);

  const renameThread = () => {
    closeMenu();
    onRenameThread?.();
  };
  const archiveThread = () => {
    closeMenu();
    onArchiveThread?.();
  };

  return (
    <span className="app-project-toolbar-title" title={project.path ?? project.name}>
      <FolderClosed className="app-project-toolbar-title__project-icon" size={15} aria-hidden="true" />
      <span className="app-project-toolbar-title__label">{title}</span>
      {hasThreadActions ? (
        <>
          <button
            className="app-project-toolbar-title__more"
            ref={triggerRef}
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t('sidebar.chatActions')}
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
            {onArchiveThread ? (
              <button type="button" role="menuitem" disabled={archiveThreadDisabled} onClick={archiveThread}>
                <Archive size={13} aria-hidden="true" />
                <span>{t('sidebar.archiveChat')}</span>
              </button>
            ) : null}
          </SidebarFloatingMenu>
        </>
      ) : null}
    </span>
  );
}
