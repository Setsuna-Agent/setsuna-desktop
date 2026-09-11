import { Button, Dropdown, type MenuItem } from '@setsuna-desktop/renderer-ui';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Archive, FolderClosed, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { workspaceOpenWithMenu } from '../../composition/workspace-apps-feature-adapter.js';
import type { DesktopWorkspaceApp } from '../../features/workspace/model.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../shared/ui/EditIcon.js';

export function AppChatToolbarTitle({
  project,
  title,
  archiveThreadDisabled = false,
  onArchiveThread,
  onRenameThread,
  selectedWorkspaceApp,
  workspaceApps,
  onOpenWorkspaceInApp,
}: {
  project?: WorkspaceProject | null;
  title: ReactNode;
  archiveThreadDisabled?: boolean;
  onArchiveThread?: () => void;
  onRenameThread?: () => void;
  selectedWorkspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps?: DesktopWorkspaceApp[];
  onOpenWorkspaceInApp?: (appId: string) => void;
}) {
  const { t } = useI18n();
  const items: MenuItem[] = [];
  if (onOpenWorkspaceInApp) {
    items.push(workspaceOpenWithMenu({
      label: t('workspace.fileMenu.openWith'), apps: workspaceApps ?? [], onOpen: onOpenWorkspaceInApp,
    }));
    if (onRenameThread || onArchiveThread) items.push({ type: 'divider' });
  }
  if (onRenameThread) items.push({ key: 'rename', label: t('sidebar.rename'), icon: <EditIcon size={13} />, onClick: onRenameThread });
  if (onArchiveThread) items.push({
    key: 'archive', label: t('sidebar.archiveChat'), icon: <Archive size={13} />,
    disabled: archiveThreadDisabled, onClick: onArchiveThread,
  });

  return (
    <span className="app-chat-toolbar-title" title={project?.path ?? project?.name}>
      {project ? <FolderClosed className="app-chat-toolbar-title__project-icon" size={15} aria-hidden="true" /> : null}
      <span className="app-chat-toolbar-title__label">{title}</span>
      {items.length ? (
        <Dropdown placement="bottomLeft" menu={{ items, selectedKeys: selectedWorkspaceApp ? [selectedWorkspaceApp.id] : [] }}>
          <Button variant="ghost"
            className="app-chat-toolbar-title__more"
            type="button"
            aria-label={t('sidebar.chatActions')}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </Button>
        </Dropdown>
      ) : null}
    </span>
  );
}
