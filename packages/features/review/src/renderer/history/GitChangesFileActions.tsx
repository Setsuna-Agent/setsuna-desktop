import { DockItem } from '@setsuna-desktop/renderer-ui';
import { Code2, Copy, MessageSquare, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost, type ReviewFileContextTarget } from '../host.js';
import { ReviewIconButton } from '../primitives.js';
import { reviewWorkspaceFilePath } from '../review-paths.js';
import type { ReviewPathContext } from '../review-types.js';
import type { GitHistoryFileActions } from './GitHistoryDiff.js';

export function GitChangesFileActions({ file, pathContext, actions, onOpenMenu }: {
  file: DesktopGitChangedFile | null;
  pathContext: ReviewPathContext;
  actions: GitHistoryFileActions;
  onOpenMenu: () => void;
}) {
  const { translate: t, ui: { FileContextMenu } } = useReviewRendererHost();
  const [menuTarget, setMenuTarget] = useState<ReviewFileContextTarget | null>(null);
  // Git paths can be outside a workspace opened at a repository subdirectory.
  const filePath = file && file.action !== 'Deleted' ? reviewWorkspaceFilePath(file.path, pathContext) : null;
  const activeMenuTarget = filePath === menuTarget?.filePath ? menuTarget : null;

  return <>
    <DockItem>
      <ReviewIconButton tooltip tooltipPlacement="top" label={t('feature.review.history.openFile')} disabled={!filePath}
        aria-haspopup="menu" aria-expanded={Boolean(activeMenuTarget)}
        onClick={(event) => {
          if (!filePath) return;
          onOpenMenu();
          const bounds = event.currentTarget.getBoundingClientRect();
          setMenuTarget({ filePath, x: bounds.left, y: bounds.top });
        }}>
        {actions.workspaceApp ? <Code2 size={16} /> : <PanelRightOpen size={16} />}
      </ReviewIconButton>
    </DockItem>
    <DockItem className="git-changes-file-navigation__shortcut">
      <ReviewIconButton tooltip tooltipPlacement="top" label={t('feature.review.history.copyFilePath')} disabled={!filePath}
        onClick={() => { if (filePath) actions.onCopyFilePath(filePath); }}>
        <Copy size={16} />
      </ReviewIconButton>
    </DockItem>
    <DockItem className="git-changes-file-navigation__shortcut">
      <ReviewIconButton tooltip tooltipPlacement="top" label={t('feature.review.history.addFileToChat')} disabled={!filePath}
        onClick={() => { if (filePath) actions.onAddFileToConversation(filePath); }}>
        <MessageSquare size={16} />
      </ReviewIconButton>
    </DockItem>
    <FileContextMenu
      openOnly
      target={activeMenuTarget}
      selectedWorkspaceApp={actions.workspaceApp ?? null}
      workspaceApps={actions.workspaceApps}
      onClose={() => setMenuTarget(null)}
      onAddToConversation={actions.onAddFileToConversation}
      onCopyPath={actions.onCopyFilePath}
      onOpenWithApp={actions.onOpenFileWithApp}
      onOpenProjectFile={actions.onOpenProjectFile}
      onReveal={actions.onRevealFile}
    />
  </>;
}
