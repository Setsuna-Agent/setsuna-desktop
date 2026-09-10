import { TextField, Button } from '@setsuna-desktop/renderer-ui';

import { Search } from 'lucide-react';
import { useState } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import type { ReviewPathContext } from '../review-types.js';
import { GitChangesFileRow } from './GitChangesFileRow.js';
import { GitChangesGroupHeader } from './GitChangesGroupHeader.js';
import { GitHistoryScrollArea } from './GitHistoryScrollArea.js';
import type { GitFileAction } from './useGitFileActions.js';

export type GitChangesFileGroup = { id: string; label: string; description?: string; files: DesktopGitChangedFile[] };

export function GitChangesFiles({ groups, pathContext, selectedKey, loading, error, filterVisible = false, busy, onSelect, onRetry, onOpen, onOpenGroup, onAction }: {
  groups: GitChangesFileGroup[];
  pathContext: ReviewPathContext;
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  filterVisible?: boolean;
  busy: boolean;
  onOpen: (path: string) => void;
  onOpenGroup: (group: string) => void;
  onAction: (action: GitFileAction, files: DesktopGitChangedFile[]) => void;
  onSelect: (group: string, file: DesktopGitChangedFile) => void;
  onRetry: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filter = filterVisible ? query.trim().toLocaleLowerCase() : '';
  const hasFiles = groups.some((group) => group.files.length > 0);
  // Filtering only changes the visible rows; group actions still target the full group.
  const visibleGroups = groups.map((group) => ({
    group,
    visibleFiles: group.files.filter((file) => !filter || file.path.toLocaleLowerCase().includes(filter)),
  })).filter(({ visibleFiles }) => visibleFiles.length > 0);
  return (
    <div className="git-changes-files">
      {filterVisible ? (
        <label className="git-changes-files__search">
          <Search size={13} />
          <TextField aria-label={t('feature.review.history.filterFiles')} placeholder={t('feature.review.history.filterFiles')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      ) : null}
      <GitHistoryScrollArea className="git-changes-files__scroll">
        {error ? <div className="git-history-status" role="alert">{error}<Button variant="ghost" type="button" onClick={onRetry}>{t('feature.review.history.retry')}</Button></div> : null}
        {loading && !hasFiles ? <p className="git-history-status">{t('feature.review.history.loading')}</p> : null}
        {visibleGroups.map(({ group, visibleFiles }) => (
          <div className="git-changes-files__group" key={group.id}>
            <GitChangesGroupHeader
              group={group}
              collapsed={collapsed.has(group.id)}
              busy={busy || loading}
              onOpen={() => onOpenGroup(group.id)}
              onAction={(action) => onAction(action, group.files)}
              onToggle={() => setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                return next;
              })}
            />
            {!collapsed.has(group.id) ? visibleFiles.map((file) => (
              <GitChangesFileRow
                key={file.path}
                file={file}
                pathContext={pathContext}
                group={group.id}
                busy={busy}
                onOpen={onOpen}
                onAction={(action, selectedFile) => onAction(action, [selectedFile])}
                selected={selectedKey === group.id + ':' + file.path}
                onSelect={() => onSelect(group.id, file)}
              />
            )) : null}
          </div>
        ))}
        {!loading && !error && !visibleGroups.length ? (
          <p className="git-history-status">{t(hasFiles ? 'feature.review.workspace.fileBrowser.noMatch' : 'feature.review.history.emptyFiles')}</p>
        ) : null}
      </GitHistoryScrollArea>
    </div>
  );
}
