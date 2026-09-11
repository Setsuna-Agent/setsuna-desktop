import { Popover } from '@setsuna-desktop/renderer-ui';
import { useRef, useState, type ReactElement } from 'react';
import type { DesktopGitCommit } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { GitHistoryCommitCard } from './GitHistoryCommitCard.js';
import { useGitCommitDetails } from './useGitCommit.js';
import { errorMessage } from './useGitHistory.js';

/** Capture the clicked commit independently of the currently selected diff. */
export function GitHistoryCommitMenu({ children, workspaceRoot, commit, onOpenChanges }: {
  children: ReactElement;
  workspaceRoot: string;
  commit: DesktopGitCommit;
  onOpenChanges: (oid: string) => void;
}) {
  const { bridge, copyText, notifyError, translate: t, ui: { ContextMenu } } = useReviewRendererHost();
  const oid = commit.oid;
  const [hoverOpen, setHoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const hoverDismissed = useRef(false);
  const dismissHover = () => {
    // Activation can hide the row before HoverCard's pending focus/hover delay expires.
    hoverDismissed.current = true;
    setHoverOpen(false);
  };
  // Wait for the hover delay before loading, then retain details for this virtual row's lifetime.
  const details = useGitCommitDetails(workspaceRoot, requested ? oid : null);
  const copy = async (field: 'id' | 'message') => {
    try {
      if (field === 'id') await copyText(oid);
      else {
        if (!bridge) throw new Error(t('feature.review.git.unsupported'));
        const selected = details.data ?? await bridge.getCommitDetails(workspaceRoot, oid);
        await copyText(selected.message);
      }
    } catch (error) {
      notifyError(t('feature.review.history.copyFailed', { error: errorMessage(error) }));
    }
  };
  return (
    <ContextMenu trigger={['contextMenu']} onOpenChange={(open) => {
      setMenuOpen(open);
      if (open) dismissHover();
    }} menu={{ items: [
      { key: 'open', label: t('feature.review.history.openCommitChanges'), onClick: () => onOpenChanges(oid) },
      { key: 'copy-id', label: t('feature.review.history.copyCommitId'), onClick: () => { void copy('id'); } },
      { key: 'copy-message', label: t('feature.review.history.copyCommitMessage'), disabled: !bridge, onClick: () => { void copy('message'); } },
    ] }}>
      <Popover
        placement="rightTop"
        trigger="hover"
        mouseEnterDelay={0.4}
        mouseLeaveDelay={0.15}
        open={hoverOpen && !menuOpen}
        onPointerEnter={() => { hoverDismissed.current = false; }}
        onFocusCapture={() => { hoverDismissed.current = false; }}
        onClickCapture={dismissHover}
        onKeyDownCapture={dismissHover}
        onOpenChange={(open) => {
          if (open && (menuOpen || hoverDismissed.current)) return;
          setHoverOpen(open);
          if (open) setRequested(true);
        }}
        className="git-commit-hover"
        content={<GitHistoryCommitCard commit={commit} details={details.data} error={details.error} onRetry={details.retry} onCopyId={() => { void copy('id'); }} />}
      >
        {children}
      </Popover>
    </ContextMenu>
  );
}
