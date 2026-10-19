import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import { SidebarHoverCard } from './SidebarHoverCard.js';
import { SidebarThreadWorktreeBadge } from './SidebarThreadWorktreeBadge.js';

export function SidebarThreadHoverCard({ children, disabled, project, thread }: {
  children: ReactElement;
  disabled: boolean;
  project?: WorkspaceProject;
  thread: RuntimeThreadSummary;
}) {
  return (
    <SidebarHoverCard
      disabled={disabled}
      className="desktop-agent-thread-preview"
      content={() => <ThreadPreview project={project} thread={thread} />}
    >
      {children}
    </SidebarHoverCard>
  );
}

function ThreadPreview({ project, thread }: { project?: WorkspaceProject; thread: RuntimeThreadSummary }) {
  const { locale, t } = useI18n();
  const updatedAt = new Date(thread.updatedAt);
  const seconds = Math.min(0, (updatedAt.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60], ['second', 1],
  ];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1];
  const inProject = Boolean(project || thread.projectId);

  return (
    <>
      <div className="desktop-agent-thread-preview__heading">
        <span className="desktop-agent-thread-preview__title">
          {thread.title}<SidebarThreadWorktreeBadge thread={thread} />
        </span>
        {Number.isFinite(seconds) ? (
          <time dateTime={thread.updatedAt} title={updatedAt.toLocaleString(locale)}>
            {new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit)}
          </time>
        ) : null}
      </div>
      <div className="desktop-agent-thread-preview__context">
        {inProject ? <ProjectIcon icon={project?.icon} size={13} /> : <MessageSquare size={13} aria-hidden="true" />}
        <span>{project?.name ?? t(inProject ? 'sidebar.projectFallback' : 'sidebar.chats')}</span>
      </div>
    </>
  );
}
