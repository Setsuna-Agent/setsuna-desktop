import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { FolderClosed, MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarHoverCard } from './SidebarHoverCard.js';

export function SidebarThreadHoverCard({ children, disabled, projectName, thread }: {
  children: ReactElement;
  disabled: boolean;
  projectName?: string;
  thread: RuntimeThreadSummary;
}) {
  return (
    <SidebarHoverCard
      disabled={disabled}
      className="desktop-agent-thread-preview"
      content={() => <ThreadPreview projectName={projectName} thread={thread} />}
    >
      {children}
    </SidebarHoverCard>
  );
}

function ThreadPreview({ projectName, thread }: { projectName?: string; thread: RuntimeThreadSummary }) {
  const { locale, t } = useI18n();
  const updatedAt = new Date(thread.updatedAt);
  const seconds = Math.min(0, (updatedAt.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60], ['second', 1],
  ];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1];
  const inProject = Boolean(projectName || thread.projectId);
  const ContextIcon = inProject ? FolderClosed : MessageSquare;

  return (
    <>
      <div className="desktop-agent-thread-preview__heading">
        <span className="desktop-agent-thread-preview__title">{thread.title}</span>
        {Number.isFinite(seconds) ? (
          <time dateTime={thread.updatedAt} title={updatedAt.toLocaleString(locale)}>
            {new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit)}
          </time>
        ) : null}
      </div>
      <div className="desktop-agent-thread-preview__context">
        <ContextIcon size={13} aria-hidden="true" />
        <span>{projectName ?? t(inProject ? 'sidebar.projectFallback' : 'sidebar.chats')}</span>
      </div>
    </>
  );
}
