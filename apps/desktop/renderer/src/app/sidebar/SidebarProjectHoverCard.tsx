import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { FolderClosed, MessageCircle, Settings } from 'lucide-react';
import type { ReactElement } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarHoverCard } from './SidebarHoverCard.js';

export function SidebarProjectHoverCard({ children, disabled, project, threadCount, onEditProject }: {
  children: ReactElement;
  disabled: boolean;
  project: WorkspaceProject;
  threadCount: number;
  onEditProject: (project: WorkspaceProject) => void;
}) {
  const { t } = useI18n();

  return (
    <SidebarHoverCard
      disabled={disabled}
      className="desktop-agent-project-preview"
      content={(dismiss) => (
        <>
          <div className="desktop-agent-project-preview__row desktop-agent-project-preview__heading">
            <FolderClosed size={14} aria-hidden="true" />
            <span>{project.name}</span>
          </div>
          <div className="desktop-agent-project-preview__row">
            <MessageCircle size={14} aria-hidden="true" />
            <span>{t(threadCount === 1 ? 'sidebar.projectChatCountOne' : 'sidebar.projectChatCount', { count: threadCount })}</span>
          </div>
          <div className="desktop-agent-project-preview__section desktop-agent-project-preview__row">
            <FolderClosed size={14} aria-hidden="true" />
            <span>{project.path ?? t('sidebar.projectDirectoryUnbound')}</span>
          </div>
          <div className="desktop-agent-project-preview__section">
            <Button
              variant="ghost"
              type="button"
              className="desktop-agent-project-preview__edit"
              onClick={() => { dismiss(); onEditProject(project); }}
            >
              <Settings size={14} aria-hidden="true" />
              {t('sidebar.editProject')}
            </Button>
          </div>
        </>
      )}
    >
      {children}
    </SidebarHoverCard>
  );
}
