import { FileSymlink, Minus, Plus, Undo2 } from 'lucide-react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewFileIcon } from '../ReviewFileVisuals.js';
import { reviewFilePathParts, reviewWorkspaceFilePath } from '../review-paths.js';
import type { ReviewPathContext } from '../review-types.js';
import type { GitFileAction } from './useGitFileActions.js';

export function GitChangesFileRow({ file, pathContext, group, selected, busy, onSelect, onOpen, onAction }: {
  file: DesktopGitChangedFile;
  pathContext: ReviewPathContext;
  group: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpen: (path: string) => void;
  onAction: (action: GitFileAction, file: DesktopGitChangedFile) => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const { filename, directory } = reviewFilePathParts(file.path);
  const workspaceFilePath = reviewWorkspaceFilePath(file.path, pathContext);
  return (
    <div className={'git-changes-file' + (selected ? ' is-selected' : '')}>
      <button className="git-changes-file__select" type="button" title={file.previousPath ? file.previousPath + ' → ' + file.path : file.path} aria-pressed={selected} onClick={onSelect}>
        <ReviewFileIcon path={file.path} />
        <span className="git-changes-file__path">
          <span className="git-changes-file__name">{filename}</span>
          {directory ? <span className="git-changes-file__directory">{directory.slice(0, -1)}</span> : null}
        </span>
      </button>
      <span className="git-changes-file__actions">
        <button type="button" disabled={file.action === 'Deleted' || !workspaceFilePath} title={t('feature.review.history.openFile')} aria-label={t('feature.review.history.openFile')} onClick={() => { if (workspaceFilePath) onOpen(workspaceFilePath); }}><FileSymlink size={14} /></button>
        {group === 'unstaged' ? <button type="button" disabled={busy} title={t('feature.review.history.discardFile')} aria-label={t('feature.review.history.discardFile')} onClick={() => onAction('discard', file)}><Undo2 size={14} /></button> : null}
        {group === 'unstaged' || group === 'staged' ? <button type="button" disabled={busy} title={t(group === 'staged' ? 'feature.review.history.unstageFile' : 'feature.review.history.stageFile')} aria-label={t(group === 'staged' ? 'feature.review.history.unstageFile' : 'feature.review.history.stageFile')} onClick={() => onAction(group === 'staged' ? 'unstage' : 'stage', file)}>{group === 'staged' ? <Minus size={15} /> : <Plus size={15} />}</button> : null}
      </span>
      <span className={'git-changes-file__status is-' + file.action.toLowerCase()}>{file.action === 'Created' ? group === 'unstaged' ? 'U' : 'A' : file.action === 'Deleted' ? 'D' : file.action === 'Renamed' ? 'R' : 'M'}</span>
    </div>
  );
}
