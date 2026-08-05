import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Check, ChevronDown, GitBranch, GitCommitHorizontal, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import {
  useWorkspaceGitCommitDialog,
} from '../../workspace/git/WorkspaceGitCommitDialog.js';
import { WorkspaceGitBranchCreateControl } from '../../workspace/git/WorkspaceGitBranchCreateControl.js';
import type { DesktopDiffSummary, DesktopReviewLoadOptions, DesktopReviewState } from '../../workspace/model.js';

type BranchBusyAction = 'checkout' | 'create' | null;

export function ConversationGitControls({
  activeProject,
  reviewError,
  reviewLoading,
  reviewState,
  onReviewRefresh,
}: {
  activeProject?: WorkspaceProject;
  reviewError: string | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  onReviewRefresh?: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { canOpenCommitDialog, openCommitDialog } = useWorkspaceGitCommitDialog();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [busyAction, setBusyAction] = useState<BranchBusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const workspaceRoot = activeProject?.path ?? '';
  const projectStateKey = activeProject ? `${activeProject.id}:${workspaceRoot}` : '';
  const hasGit = Boolean(reviewState?.isGitRepository);
  const currentBranch = reviewState?.currentBranch || 'HEAD';
  const currentBranchLabel = reviewLoading
    ? t('conversation.overview.loading')
    : reviewState
      ? currentBranch
      : reviewError
        ? t('conversation.overview.loadFailed')
        : t('conversation.overview.loading');
  const unstagedFileCount = fileCount(reviewState?.unstagedSummary);
  const createBranchDisabledReason = unstagedFileCount > 0
    ? t('conversation.git.unstagedBranchBlocked')
    : null;
  const filteredBranches = useMemo(() => {
    const branches = reviewState?.branches ?? [];
    const normalizedQuery = branchQuery.trim().toLowerCase();
    return normalizedQuery
      ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
      : branches;
  }, [branchQuery, reviewState?.branches]);

  useEffect(() => {
    if (!branchMenuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeBranchMenu();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [branchMenuOpen]);

  useEffect(() => {
    setBranchMenuOpen(false);
    setBranchQuery('');
    setCreatingBranch(false);
    setBranchDraft('');
    setBusyAction(null);
    setError(null);
  }, [projectStateKey]);

  if (!activeProject || (reviewState && !reviewState.isGitRepository)) return null;

  const closeBranchCreate = () => {
    setCreatingBranch(false);
    setBranchDraft('');
  };

  const closeBranchMenu = () => {
    setBranchMenuOpen(false);
    setBranchQuery('');
    setError(null);
    closeBranchCreate();
  };

  const runBranchAction = async (action: BranchBusyAction, task: () => Promise<void>) => {
    if (!workspaceRoot || busyAction) return;
    const api = window.setsunaDesktop?.desktopReview;
    if (!api) {
      setError(t('conversation.git.unsupported'));
      return;
    }
    setBusyAction(action);
    setError(null);
    try {
      await task();
      await onReviewRefresh?.();
    } catch (unknownError) {
      setError(gitControlErrorMessage(unknownError, t));
    } finally {
      setBusyAction(null);
    }
  };

  const checkoutBranch = (branchName: string) => {
    void runBranchAction('checkout', async () => {
      await window.setsunaDesktop?.desktopReview.checkoutBranch(workspaceRoot, branchName);
      closeBranchMenu();
    });
  };

  const createBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branchName = branchDraft.trim();
    if (!branchName) {
      setError(t('conversation.git.branchRequired'));
      return;
    }
    void runBranchAction('create', async () => {
      await window.setsunaDesktop?.desktopReview.createBranch(workspaceRoot, branchName);
      closeBranchMenu();
    });
  };

  return (
    <div className="chat-conversation-git" ref={rootRef}>
      <button
        type="button"
        className="chat-conversation-overview-panel__row chat-conversation-git__branch-row"
        disabled={!hasGit || reviewLoading}
        onClick={() => {
          setBranchMenuOpen((open) => !open);
          setError(null);
        }}
      >
        <span className="chat-conversation-overview-panel__icon">
          <GitBranch size={14} />
        </span>
        <span className="chat-conversation-overview-panel__label">{t('conversation.git.branch')}</span>
        <span
          className="chat-conversation-overview-panel__meta"
          title={!reviewState && reviewError ? reviewError : undefined}
        >
          {currentBranchLabel}
          <ChevronDown size={12} />
        </span>
      </button>
      <button
        type="button"
        className="chat-conversation-overview-panel__row"
        disabled={!canOpenCommitDialog}
        onClick={() => {
          closeBranchMenu();
          openCommitDialog();
        }}
      >
        <span className="chat-conversation-overview-panel__icon">
          <GitCommitHorizontal size={14} />
        </span>
        <span className="chat-conversation-overview-panel__label">{t('conversation.git.commitOrPush')}</span>
      </button>

      {branchMenuOpen ? (
        <BranchMenu
          branchDraft={branchDraft}
          busyAction={busyAction}
          creatingBranch={creatingBranch}
          createDisabledReason={createBranchDisabledReason}
          currentBranch={currentBranch}
          error={error}
          filteredBranches={filteredBranches}
          query={branchQuery}
          onBranchDraftChange={setBranchDraft}
          onCancelCreate={closeBranchCreate}
          onCheckout={checkoutBranch}
          onCreate={createBranch}
          onCreateStart={() => {
            setCreatingBranch(true);
            setError(null);
          }}
          onQueryChange={setBranchQuery}
          t={t}
        />
      ) : null}
    </div>
  );
}

function BranchMenu({
  branchDraft,
  busyAction,
  creatingBranch,
  createDisabledReason,
  currentBranch,
  error,
  filteredBranches,
  query,
  onBranchDraftChange,
  onCancelCreate,
  onCheckout,
  onCreate,
  onCreateStart,
  onQueryChange,
  t,
}: {
  branchDraft: string;
  busyAction: BranchBusyAction;
  creatingBranch: boolean;
  createDisabledReason: string | null;
  currentBranch: string;
  error: string | null;
  filteredBranches: DesktopReviewState['branches'];
  query: string;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCheckout: (branchName: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  onQueryChange: (value: string) => void;
  t: Translate;
}) {
  return (
    <div className="chat-git-branch-menu">
      <label className="chat-git-branch-menu__search">
        <Search size={13} />
        <input
          value={query}
          placeholder={t('conversation.git.searchBranches')}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      <div className="chat-git-branch-menu__label">{t('conversation.git.branch')}</div>
      <div className="chat-git-branch-menu__list">
        {filteredBranches.length ? filteredBranches.map((branch) => (
          <button
            type="button"
            className={`chat-git-branch-menu__item ${branch.current ? 'is-current' : ''} ${branch.uncommittedFiles > 0 ? 'has-detail' : ''}`}
            disabled={Boolean(busyAction) || branch.name === currentBranch}
            key={branch.name}
            onClick={() => onCheckout(branch.name)}
          >
            <GitBranch size={14} />
            <span className="chat-git-branch-menu__item-body">
              <span>{branch.name}</span>
              {branch.uncommittedFiles > 0 ? (
                <small>{t(branch.uncommittedFiles === 1
                  ? 'conversation.git.uncommittedFiles.one'
                  : 'conversation.git.uncommittedFiles.many', { count: branch.uncommittedFiles })}</small>
              ) : null}
            </span>
            <span className="chat-git-branch-menu__check">
              {branch.current ? <Check size={13} /> : null}
            </span>
          </button>
        )) : (
          <div className="chat-git-branch-menu__empty">{t('conversation.git.noMatchingBranches')}</div>
        )}
      </div>
      <div className="chat-git-branch-menu__divider" />
      <WorkspaceGitBranchCreateControl
        branchDraft={branchDraft}
        busy={Boolean(busyAction)}
        creatingBranch={creatingBranch}
        disabledReason={createDisabledReason}
        submitting={busyAction === 'create'}
        onBranchDraftChange={onBranchDraftChange}
        onCancelCreate={onCancelCreate}
        onCreate={onCreate}
        onCreateStart={onCreateStart}
        t={t}
      />
      {error ? <div className="chat-git-branch-menu__error">{error}</div> : null}
    </div>
  );
}

function fileCount(summary: DesktopDiffSummary | null | undefined): number {
  return summary?.files.length ?? 0;
}

function gitControlErrorMessage(error: unknown, t: Translate): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = rawMessage.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/u, '');
  const withoutRuntimePath = withoutIpcPrefix.replace(/\s*\((?:GET|POST|PUT|PATCH|DELETE)\s+\/v\d+\/[^)]+\)\s*$/u, '');
  return withoutRuntimePath.trim() || t('conversation.git.operationFailed');
}

export {
  GitActionButton,
  commitSuccessMessage,
} from '../../workspace/git/WorkspaceGitCommitDialog.js';
