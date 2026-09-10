import { Button } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, Files, Minus, Plus, Undo2 } from 'lucide-react';
import { useReviewRendererHost } from '../host.js';
import { ReviewIconButton } from '../primitives.js';
import type { GitChangesFileGroup } from './GitChangesFiles.js';
import type { GitFileAction } from './useGitFileActions.js';

export function GitChangesGroupHeader({ group, collapsed, busy, onToggle, onOpen, onAction }: {
  group: GitChangesFileGroup;
  collapsed: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAction: (action: GitFileAction) => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const isWorktree = group.id === 'staged' || group.id === 'unstaged';
  return (
    <div className="git-history-section-heading git-changes-files__group-heading">
      <Button variant="ghost" type="button" className="git-changes-files__group-toggle" aria-expanded={!collapsed} title={[group.description, group.label].filter(Boolean).join(' · ')} onClick={onToggle}>
        <ChevronDown size={12} className={collapsed ? 'is-collapsed' : ''} />
        <span className="git-changes-files__group-label">{group.label}</span>
        {group.description ? <code>{group.description}</code> : null}
      </Button>
      {isWorktree ? (
        <span className="git-changes-group__actions">
          <ReviewIconButton tooltip label={t('feature.review.history.openGroup')} onClick={onOpen}><Files size={14} /></ReviewIconButton>
          {group.id === 'unstaged' ? (
            <ReviewIconButton tooltip label={t('feature.review.history.discardGroup')} disabled={busy} onClick={() => onAction('discard')}><Undo2 size={14} /></ReviewIconButton>
          ) : null}
          <ReviewIconButton tooltip label={t(group.id === 'staged' ? 'feature.review.history.unstageGroup' : 'feature.review.history.stageGroup')} disabled={busy} onClick={() => onAction(group.id === 'staged' ? 'unstage' : 'stage')}>
            {group.id === 'staged' ? <Minus size={15} /> : <Plus size={15} />}
          </ReviewIconButton>
        </span>
      ) : null}
      <span className="git-changes-count">{group.files.length}</span>
    </div>
  );
}
