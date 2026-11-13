import { ToastNotice, TextField, Button, Popover } from '@setsuna-desktop/renderer-ui';

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Check, GitBranch, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DesktopReviewBridge,
  DesktopReviewState,
} from '../contracts/index.js';
import { WorkspaceGitBranchCreateDialog } from './git/WorkspaceGitBranchCreateDialog.js';
import { useReviewRendererHost } from './host.js';
import type { ReviewTranslate } from './messages.js';
import { useReviewRequestGuard } from './request-guard.js';

type BranchBusyAction = 'checkout' | 'create' | null;

export function ConversationGitControls({
  activeProject,
  variant = 'overview',
  reviewError,
  reviewLoading,
  reviewState,
  onReviewRefresh,
}: {
  activeProject?: WorkspaceProject;
  variant?: 'overview' | 'compact';
  reviewError: string | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  onReviewRefresh?: () => void | Promise<void>;
}) {
  const { bridge, translate: t } = useReviewRendererHost();
  const branchRequests = useReviewRequestGuard();
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [busyAction, setBusyAction] = useState<BranchBusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const workspaceRoot = activeProject?.path ?? '';
  const projectStateKey = activeProject ? `${activeProject.id}:${workspaceRoot}` : '';
  const hasGit = Boolean(reviewState?.isGitRepository);
  const branchLocked = reviewState?.isWorktree === true;
  const currentBranch = branchLocked ? 'HEAD' : reviewState?.currentBranch || 'HEAD';
  const currentBranchLabel = reviewLoading
    ? t('feature.review.git.loading')
    : reviewState
      ? currentBranch
      : reviewError
        ? t('feature.review.git.loadFailed')
        : t('feature.review.git.loading');
  const filteredBranches = useMemo(() => {
    const branches = reviewState?.branches ?? [];
    const normalizedQuery = branchQuery.trim().toLowerCase();
    return normalizedQuery
      ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
      : branches;
  }, [branchQuery, reviewState?.branches]);

  useEffect(() => {
    branchRequests.invalidate();
    setBranchMenuOpen(false);
    setBranchQuery('');
    setCreatingBranch(false);
    setBranchDraft('');
    setBusyAction(null);
    setError(null);
  }, [branchRequests, projectStateKey]);

  if (!workspaceRoot || (reviewState && !reviewState.isGitRepository)) return null;

  const closeBranchCreate = () => {
    setCreatingBranch(false);
    setBranchDraft('');
    setError(null);
  };

  const closeBranchMenu = () => {
    setBranchMenuOpen(false);
    setBranchQuery('');
    setError(null);
  };

  const runBranchAction = async (
    action: BranchBusyAction,
    task: (api: DesktopReviewBridge) => Promise<DesktopReviewState>,
  ) => {
    if (!workspaceRoot || busyAction || branchLocked) return;
    const api = bridge;
    if (!api) {
      setError(t('feature.review.git.unsupported'));
      return;
    }
    setBusyAction(action);
    setError(null);
    const isLatest = branchRequests.begin();
    try {
      await task(api);
      // The user may select another project while native Git is still running.
      if (!isLatest()) return;
      closeBranchMenu();
      closeBranchCreate();
      await onReviewRefresh?.();
    } catch (unknownError) {
      if (isLatest()) setError(gitControlErrorMessage(unknownError, t));
    } finally {
      if (isLatest()) setBusyAction(null);
    }
  };

  const checkoutBranch = (branchName: string) => {
    void runBranchAction('checkout', (api) => api.checkoutBranch(workspaceRoot, branchName));
  };

  const createBranch = () => {
    const branchName = branchDraft.trim();
    if (!branchName) {
      setError(t('feature.review.git.branchRequired'));
      return;
    }
    void runBranchAction('create', (api) => api.createBranch(workspaceRoot, branchName, { stageUnstaged: true }));
  };

  return (
    <div className={`chat-conversation-git${variant === 'compact' ? ' chat-conversation-git--compact' : ''}`}>
      <Popover
        open={branchMenuOpen && !branchLocked}
        onOpenChange={(open) => {
          if (open && !branchLocked) {
            setBranchMenuOpen(true);
            setError(null);
          } else closeBranchMenu();
        }}
        onCloseAutoFocus={(event) => { if (creatingBranch) event.preventDefault(); }}
        placement={variant === 'compact' ? 'topLeft' : 'leftTop'}
        className="sd-menu-surface sd-picker"
        content={(
          <BranchMenu
            busyAction={busyAction}
            currentBranch={currentBranch}
            filteredBranches={filteredBranches}
            query={branchQuery}
            onCheckout={checkoutBranch}
            onCreateStart={() => {
              // The dialog must return focus to the surviving trigger, not the removed menu item.
              branchTriggerRef.current?.focus({ preventScroll: true });
              closeBranchMenu();
              setCreatingBranch(true);
            }}
            onQueryChange={setBranchQuery}
            t={t}
          />
        )}
      >
        <Button variant="ghost"
          ref={branchTriggerRef}
          type="button"
          className={variant === 'compact'
            ? 'sd-picker-trigger'
            : 'chat-conversation-overview-panel__row chat-conversation-git__branch-row'}
          disabled={branchLocked || !hasGit || reviewLoading || Boolean(busyAction)}
          aria-label={`${t('feature.review.git.branch')}: ${currentBranchLabel}`}
          title={reviewState ? currentBranch : reviewError ?? undefined}
        >
          {variant === 'compact' ? <>
            <GitBranch size={14} aria-hidden="true" />
            <span className="chat-conversation-git__branch-name">{currentBranchLabel}</span>
          </> : <>
            <span className="chat-conversation-overview-panel__icon"><GitBranch size={14} /></span>
            <span className="chat-conversation-overview-panel__label">{t('feature.review.git.branch')}</span>
            <span className="chat-conversation-overview-panel__meta">
              <span className="chat-conversation-git__branch-name">{currentBranchLabel}</span>
            </span>
          </>}
        </Button>
      </Popover>
      {creatingBranch && !branchLocked ? (
        <WorkspaceGitBranchCreateDialog
          branchDraft={branchDraft}
          busy={Boolean(busyAction)}
          error={error}
          onBranchDraftChange={setBranchDraft}
          onClose={closeBranchCreate}
          onCreate={createBranch}
          t={t}
        />
      ) : null}
      {error && !creatingBranch ? <ToastNotice message={error} /> : null}
    </div>
  );
}

function BranchMenu({
  busyAction,
  currentBranch,
  filteredBranches,
  query,
  onCheckout,
  onCreateStart,
  onQueryChange,
  t,
}: {
  busyAction: BranchBusyAction;
  currentBranch: string;
  filteredBranches: DesktopReviewState['branches'];
  query: string;
  onCheckout: (branchName: string) => void;
  onCreateStart: () => void;
  onQueryChange: (value: string) => void;
  t: ReviewTranslate;
}) {
  return (
    <>
      <label className="sd-picker__search">
        <Search size={14} aria-hidden="true" />
        <TextField
          value={query}
          aria-label={t('feature.review.git.searchBranches')}
          placeholder={t('feature.review.git.searchBranches')}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      <div className="sd-picker__list">
        {filteredBranches.length ? filteredBranches.map((branch) => (
          <Button variant="ghost"
            type="button"
            className="sd-picker__item"
            aria-current={branch.current ? 'true' : undefined}
            disabled={Boolean(busyAction) || branch.name === currentBranch}
            key={branch.name}
            onClick={() => onCheckout(branch.name)}
          >
            <GitBranch size={14} aria-hidden="true" />
            <span>{branch.name}</span>
            {branch.current ? <Check size={14} aria-hidden="true" /> : null}
          </Button>
        )) : (
          <div className="sd-picker__empty">{t('feature.review.git.noMatchingBranches')}</div>
        )}
      </div>
      <div className="sd-picker__actions">
        <Button variant="ghost" className="sd-picker__item" disabled={Boolean(busyAction)} onClick={onCreateStart}>
          <Plus size={14} aria-hidden="true" />
          <span>{t('feature.review.git.createAndCheckout')}</span>
        </Button>
      </div>
    </>
  );
}

function gitControlErrorMessage(error: unknown, t: ReviewTranslate): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = rawMessage.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/u, '');
  const withoutRuntimePath = withoutIpcPrefix.replace(/\s*\((?:GET|POST|PUT|PATCH|DELETE)\s+\/v\d+\/[^)]+\)\s*$/u, '');
  return withoutRuntimePath.trim() || t('feature.review.git.operationFailed');
}
