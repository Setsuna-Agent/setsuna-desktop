import { Archive, ChevronDown, GitMerge, MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GitConflictTaskRecord } from '../context.js';
import { useReviewRendererHost } from '../host.js';
import { GitHistoryScrollArea } from './GitHistoryScrollArea.js';
import { ReviewIconButton } from '../primitives.js';
import { useGitConflictArchive } from './useGitConflictArchive.js';

export function GitConflictHistory({ workspaceRoot, tasks, selectedTurnId, onSelect }: {
  workspaceRoot: string;
  tasks: readonly GitConflictTaskRecord[];
  selectedTurnId: string | null;
  onSelect: (turnId: string | null) => void;
}) {
  const { locale, translate: t, ui: { ContextMenu } } = useReviewRendererHost();
  const [expanded, setExpanded] = useState(true);
  const archive = useGitConflictArchive(workspaceRoot);
  const visibleTasks = tasks.filter((task) => !task.archived);
  const archiveLabel = t('feature.review.git.archiveConflict');
  const archiveRecords = async (records: readonly GitConflictTaskRecord[]) => {
    const archived = await archive.archiveTasks(records);
    if (selectedTurnId && archived.includes(selectedTurnId)) onSelect(null);
  };
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }), [locale]);
  const labels = {
    pull: t('feature.review.git.conflictPull'),
    rebase: t('feature.review.git.conflictRebase'),
    sync: t('feature.review.git.conflictSync'),
  };

  return (
    <section className={'git-conflict-history' + (expanded ? '' : ' is-collapsed')} aria-label={t('feature.review.git.conflictHistory')}>
      <div className="git-conflict-history__header">
        <button className="git-history-section-heading" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <GitMerge size={14} />
          <span className="git-history-graph__heading">{t('feature.review.git.conflicts')}</span>
          <span className="git-changes-count">{visibleTasks.length}</span>
          <ChevronDown size={13} className={expanded ? '' : 'is-collapsed'} />
        </button>
        <ReviewIconButton className="git-conflict-history__archive-all" label={t('feature.review.git.archiveAllConflicts')}
          disabled={archive.disabled || !visibleTasks.length} aria-busy={archive.pending}
          onClick={() => { void archiveRecords(visibleTasks); }}><Archive size={13} /></ReviewIconButton>
      </div>
      {expanded ? <GitHistoryScrollArea>
        <div role="list">
          {tasks.map((task, index) => {
            if (task.archived) return null;
            const title = `${labels[task.operation]} · ${tasks.length - index}`;
            return <ContextMenu key={task.turnId} trigger={['contextMenu']} menu={{ items: [
              { key: 'archive', icon: <Archive size={14} />, label: archiveLabel, disabled: archive.disabled, onClick: () => { void archiveRecords([task]); } },
            ] }}><div role="listitem" className="git-conflict-history__row">
              <button className="git-conflict-history__entry" type="button" aria-pressed={selectedTurnId === task.turnId} onClick={() => onSelect(task.turnId)}>
                <MessageSquare size={14} />
                <span>{title}</span>
                <time dateTime={task.createdAt} title={new Date(task.createdAt).toLocaleString(locale)}>{dateFormat.format(new Date(task.createdAt))}</time>
              </button>
              <ReviewIconButton className="git-conflict-history__archive" label={archiveLabel} disabled={archive.disabled} onClick={() => { void archiveRecords([task]); }}>
                <Archive size={13} />
              </ReviewIconButton>
            </div></ContextMenu>;
          })}
        </div>
        {!visibleTasks.length ? <div className="git-history-status">{t('feature.review.git.noUnarchivedConflicts')}</div> : null}
      </GitHistoryScrollArea> : null}
    </section>
  );
}
