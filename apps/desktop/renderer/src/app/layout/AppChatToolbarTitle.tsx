import { Button, Dropdown } from '@setsuna-desktop/renderer-ui';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { FolderClosed, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { threadMenuItems, type ThreadMenuOptions } from '../thread-menu/threadMenuItems.js';

export function AppChatToolbarTitle({ project, title, menu, menuOpen, onMenuOpenChange }: {
  project?: WorkspaceProject | null;
  title: ReactNode;
  menu: ThreadMenuOptions;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <span className="app-chat-toolbar-title" title={project?.path ?? project?.name}>
      {project ? <FolderClosed className="app-chat-toolbar-title__project-icon" size={15} aria-hidden="true" /> : null}
      <span className="app-chat-toolbar-title__label">{title}</span>
      <Dropdown placement="bottomLeft" open={menuOpen} onOpenChange={onMenuOpenChange} menu={{ items: threadMenuItems(menu, t) }}>
        <Button variant="ghost"
          className="app-chat-toolbar-title__more"
          type="button"
          aria-label={t('sidebar.chatActions')}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </Button>
      </Dropdown>
    </span>
  );
}
