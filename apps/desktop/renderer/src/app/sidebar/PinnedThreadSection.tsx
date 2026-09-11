import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarThreadList } from './SidebarThreadList.js';

export function PinnedThreadSection({ projects, threads, ...listProps }: {
  projects: WorkspaceProject[];
  threads: RuntimeThreadSummary[];
} & Pick<ComponentProps<typeof SidebarThreadList>,
  'menuThreadId' | 'runningThreadId' | 'selectedThreadId' | 'onArchive' | 'onRename' | 'onSelect' | 'onToggleMenu' | 'onTogglePin'
>) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const projectNamesById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  if (!threads.length) return null;

  return (
    <section className="desktop-agent-sidebar__group" aria-label={t('sidebar.pinned')}>
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost"
          className="desktop-agent-sidebar__section-title-button"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span>{t('sidebar.pinned')}</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${collapsed ? 'is-collapsed' : ''}`} size={13} />
        </Button>
      </div>
      {!collapsed ? (
        <SidebarThreadList {...listProps} projectNamesById={projectNamesById} threads={threads} variant="pinned" />
      ) : null}
    </section>
  );
}
