import type { DesktopReviewCommitResult, WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  Plus,
  Search,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import type { DesktopDiffSummary, DesktopReviewLoadOptions, DesktopReviewState } from '../../workspace/model.js';
import { localReviewChangeStats } from '../../workspace/reviewChanges.js';
import { ChangeCountText } from './ChangeCountText.js';

type GitBusyAction = 'checkout' | 'commit' | 'commit-and-push' | 'create' | 'push' | null;
type CommitPhase = 'committing' | 'generating' | null;

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
  const toast = useToast();
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const commitModalRef = useRef<HTMLDivElement | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitBranchMenuOpen, setCommitBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [busyAction, setBusyAction] = useState<GitBusyAction>(null);
  const [commitPhase, setCommitPhase] = useState<CommitPhase>(null);
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
  const changeStats = useMemo(() => localReviewChangeStats(reviewState), [reviewState]);
  const unstagedFileCount = fileCount(reviewState?.unstagedSummary);
  const createBranchDisabledReason = unstagedFileCount > 0 ? t('conversation.git.unstagedBranchBlocked') : null;
  const commitableFileCount = includeUnstaged ? changeStats.fileCount : fileCount(reviewState?.stagedSummary);
  const filteredBranches = useMemo(() => {
    const branches = reviewState?.branches ?? [];
    const normalizedQuery = branchQuery.trim().toLowerCase();
    return normalizedQuery ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery)) : branches;
  }, [branchQuery, reviewState?.branches]);

  useEffect(() => {
    if (!branchMenuOpen && !commitOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || commitModalRef.current?.contains(target)) return;
      closeFloatingMenus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [branchMenuOpen, commitOpen]);

  useEffect(() => {
    setBranchMenuOpen(false);
    setCommitOpen(false);
    setCommitBranchMenuOpen(false);
    setBranchQuery('');
    setCommitMessage('');
    setIncludeUnstaged(true);
    setCreatingBranch(false);
    setBranchDraft('');
    setError(null);
  }, [projectStateKey]);

  if (!activeProject || (reviewState && !reviewState.isGitRepository)) return null;

  const refreshReview = async () => {
    await onReviewRefresh?.();
  };

  const closeBranchCreate = () => {
    setCreatingBranch(false);
    setBranchDraft('');
  };

  const closeFloatingMenus = () => {
    setBranchMenuOpen(false);
    setCommitBranchMenuOpen(false);
    setBranchQuery('');
    setError(null);
    closeBranchCreate();
  };

  const resetCommitPanel = () => {
    setCommitOpen(false);
    setCommitBranchMenuOpen(false);
    setCommitMessage('');
    setIncludeUnstaged(true);
    setError(null);
    closeBranchCreate();
  };

  const closeCommitPanel = () => {
    if (busyAction) return;
    resetCommitPanel();
  };

  const runGitAction = async (action: GitBusyAction, task: () => Promise<void>) => {
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
      await refreshReview();
    } catch (unknownError) {
      setError(gitControlErrorMessage(unknownError, t));
    } finally {
      setBusyAction(null);
      if (isCommitAction(action)) setCommitPhase(null);
    }
  };

  const checkoutBranch = (branchName: string) => {
    void runGitAction('checkout', async () => {
      await window.setsunaDesktop?.desktopReview.checkoutBranch(workspaceRoot, branchName);
      closeFloatingMenus();
    });
  };

  const createBranch = (event: FormEvent<HTMLFormElement>, options: { allowUnstaged?: boolean } = {}) => {
    event.preventDefault();
    const branchName = branchDraft.trim();
    if (!branchName) {
      setError(t('conversation.git.branchRequired'));
      return;
    }
    void runGitAction('create', async () => {
      await window.setsunaDesktop?.desktopReview.createBranch(workspaceRoot, branchName, options);
      closeFloatingMenus();
    });
  };

  const commitChanges = (push: boolean) => {
    const action = push ? 'commit-and-push' : 'commit';
    void runGitAction(action, async () => {
      const api = window.setsunaDesktop?.desktopReview;
      if (!api) throw new Error(t('conversation.git.unsupported'));
      let message = commitMessage.trim();
      if (!message) {
        setCommitPhase('generating');
        const generated = await api.generateCommitMessage(workspaceRoot, { includeUnstaged });
        message = generated.message.trim();
        if (!message) throw new Error(t('conversation.git.messageGenerationFailed'));
        setCommitMessage(message);
      }
      setCommitPhase('committing');
      const result = await api.commit(workspaceRoot, { includeUnstaged, message, push });
      closeFloatingMenus();
      if (result.pushError) {
        setCommitMessage('');
        setError(t('conversation.git.pushAfterCommitFailed', {
          hash: result.commitHash || t('conversation.git.commitFinished'),
          error: result.pushError,
        }));
      } else {
        resetCommitPanel();
        toast.success(commitSuccessMessage(result, push, t));
      }
    });
  };

  const pushBranch = () => {
    void runGitAction('push', async () => {
      await window.setsunaDesktop?.desktopReview.push(workspaceRoot);
      resetCommitPanel();
      toast.success(t('conversation.git.pushSuccess', { branch: currentBranch }));
    });
  };

  const openCommitPanel = () => {
    setBranchMenuOpen(false);
    if (commitOpen) {
      closeCommitPanel();
      return;
    }
    resetCommitPanel();
    setCommitOpen(true);
  };

  const commitModal = commitOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="chat-git-commit-modal"
      ref={commitModalRef}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        closeCommitPanel();
      }}
    >
      <div className="chat-git-commit-popover" role="dialog" aria-modal="true" aria-label={t('conversation.git.commitOrPush')}>
        <div className="chat-git-commit-popover__head">
          <div className="chat-git-commit-popover__branch-wrap">
            <button
              type="button"
              className={`chat-git-commit-popover__branch ${commitBranchMenuOpen ? 'is-open' : ''}`}
              aria-expanded={commitBranchMenuOpen}
              disabled={Boolean(busyAction)}
              onClick={() => {
                setCommitBranchMenuOpen((open) => !open);
                setError(null);
              }}
            >
              <GitBranch size={13} />
              <span>{currentBranch}</span>
              <ChevronDown size={12} />
            </button>
            {commitBranchMenuOpen ? (
              <CommitBranchMenu
                branchDraft={branchDraft}
                busyAction={busyAction}
                creatingBranch={creatingBranch}
                currentBranch={currentBranch}
                error={error}
                onBranchDraftChange={setBranchDraft}
                onCancelCreate={closeBranchCreate}
                onCreate={(event) => createBranch(event, { allowUnstaged: true })}
                onCreateStart={() => {
                  setCreatingBranch(true);
                  setError(null);
                }}
                t={t}
              />
            ) : null}
          </div>
          <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
        </div>
        <textarea
          className="chat-git-commit-popover__message"
          value={commitMessage}
          rows={3}
          placeholder={t('conversation.git.messagePlaceholder')}
          disabled={Boolean(busyAction)}
          onChange={(event) => setCommitMessage(event.currentTarget.value)}
        />
        <label className="chat-git-commit-popover__check">
          <input
            type="checkbox"
            checked={includeUnstaged}
            disabled={Boolean(busyAction)}
            onChange={(event) => setIncludeUnstaged(event.currentTarget.checked)}
          />
          <span>{t('conversation.git.includeUnstaged')}</span>
        </label>
        <div className="chat-git-commit-popover__divider" />
        <div className="chat-git-commit-popover__actions">
          <GitActionButton
            disabled={Boolean(busyAction) || commitableFileCount === 0}
            icon={<GitCommitHorizontal size={14} />}
            loading={busyAction === 'commit'}
            title={busyAction === 'commit'
              ? commitPhase === 'generating' ? t('conversation.git.generatingMessage') : t('conversation.git.committing')
              : t('conversation.git.commit')}
            onClick={() => commitChanges(false)}
          />
          <GitActionButton
            disabled={Boolean(busyAction) || commitableFileCount === 0}
            icon={<GitPullRequestArrow size={14} />}
            loading={busyAction === 'commit-and-push'}
            title={busyAction === 'commit-and-push'
              ? commitPhase === 'generating' ? t('conversation.git.generatingMessage') : t('conversation.git.commitAndPushing')
              : t('conversation.git.commitAndPush')}
            onClick={() => commitChanges(true)}
          />
          <GitActionButton
            disabled={Boolean(busyAction)}
            icon={<UploadCloud size={14} />}
            loading={busyAction === 'push'}
            title={t('conversation.git.push')}
            onClick={pushBranch}
          />
        </div>
        {error && !commitBranchMenuOpen ? <div className="chat-git-commit-popover__error">{error}</div> : null}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="chat-conversation-git" ref={rootRef}>
      <button
        type="button"
        className="chat-conversation-overview-panel__row chat-conversation-git__branch-row"
        disabled={!hasGit || reviewLoading}
        onClick={() => {
          resetCommitPanel();
          setBranchMenuOpen((open) => !open);
        }}
      >
        <span className="chat-conversation-overview-panel__icon">
          <GitBranch size={14} />
        </span>
        <span className="chat-conversation-overview-panel__label">{t('conversation.git.branch')}</span>
        <span className="chat-conversation-overview-panel__meta" title={!reviewState && reviewError ? reviewError : undefined}>
          {currentBranchLabel}
          <ChevronDown size={12} />
        </span>
      </button>
      <button
        type="button"
        className="chat-conversation-overview-panel__row"
        disabled={!hasGit || reviewLoading}
        onClick={openCommitPanel}
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

      {commitModal}
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
  busyAction: GitBusyAction;
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
            <span className="chat-git-branch-menu__check">{branch.current ? <Check size={13} /> : null}</span>
          </button>
        )) : <div className="chat-git-branch-menu__empty">{t('conversation.git.noMatchingBranches')}</div>}
      </div>
      <div className="chat-git-branch-menu__divider" />
      <CreateBranchControl
        branchDraft={branchDraft}
        busyAction={busyAction}
        creatingBranch={creatingBranch}
        disabledReason={createDisabledReason}
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

function CommitBranchMenu({
  branchDraft,
  busyAction,
  creatingBranch,
  currentBranch,
  error,
  onBranchDraftChange,
  onCancelCreate,
  onCreate,
  onCreateStart,
  t,
}: {
  branchDraft: string;
  busyAction: GitBusyAction;
  creatingBranch: boolean;
  currentBranch: string;
  error: string | null;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  t: Translate;
}) {
  return (
    <div className="chat-git-commit-branch-menu">
      <div className="chat-git-commit-branch-menu__label">{t('conversation.git.commitTo')}</div>
      <div className="chat-git-commit-branch-menu__item is-current">
        <GitBranch size={14} />
        <span>{currentBranch}</span>
        <Check size={13} />
      </div>
      <CreateBranchControl
        branchDraft={branchDraft}
        busyAction={busyAction}
        creatingBranch={creatingBranch}
        compact
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

function CreateBranchControl({
  branchDraft,
  busyAction,
  compact = false,
  creatingBranch,
  disabledReason,
  onBranchDraftChange,
  onCancelCreate,
  onCreate,
  onCreateStart,
  t,
}: {
  branchDraft: string;
  busyAction: GitBusyAction;
  compact?: boolean;
  creatingBranch: boolean;
  disabledReason?: string | null;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  t: Translate;
}) {
  const createDisabled = Boolean(busyAction) || Boolean(disabledReason);
  if (!creatingBranch) {
    return (
      <button
        type="button"
        className={`chat-git-branch-menu__create ${disabledReason ? 'has-detail' : ''}`}
        disabled={createDisabled}
        title={disabledReason ?? undefined}
        onClick={onCreateStart}
      >
        <Plus size={14} />
        <span className="chat-git-branch-menu__create-body">
          <span>{t(compact ? 'conversation.git.newBranch' : 'conversation.git.createAndCheckout')}</span>
          {disabledReason ? <small>{disabledReason}</small> : null}
        </span>
      </button>
    );
  }
  return (
    <form className={`chat-git-branch-menu__create-form ${compact ? 'chat-git-branch-menu__create-form--compact' : ''}`} onSubmit={onCreate}>
      <input
        autoFocus
        value={branchDraft}
        placeholder={t('conversation.git.branchNamePlaceholder')}
        disabled={createDisabled}
        onChange={(event) => onBranchDraftChange(event.currentTarget.value)}
      />
      <button type="submit" disabled={createDisabled} aria-label={t('conversation.git.createBranch')} title={disabledReason ?? undefined}>
        {busyAction === 'create' ? <Loader2 className="chat-git-loading-icon" size={13} /> : compact ? t('conversation.git.create') : <Check size={13} />}
      </button>
      <button type="button" disabled={Boolean(busyAction)} onClick={onCancelCreate}>
        {t('common.cancel')}
      </button>
    </form>
  );
}

export function GitActionButton({
  disabled,
  icon,
  loading,
  title,
  onClick,
}: {
  disabled: boolean;
  icon: ReactNode;
  loading?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="chat-git-commit-popover__action"
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="chat-git-commit-popover__action-icon">{loading ? <Loader2 className="chat-git-loading-icon" size={14} /> : icon}</span>
      <span>{title}</span>
    </button>
  );
}

export function commitSuccessMessage(result: Pick<DesktopReviewCommitResult, 'commitHash'>, pushed: boolean, t?: Translate): string {
  const action = t
    ? t(pushed ? 'conversation.git.commitPushSuccess' : 'conversation.git.commitSuccess')
    : pushed ? '提交并推送成功' : '提交成功';
  return result.commitHash ? `${action} · ${result.commitHash}` : action;
}

function isCommitAction(action: GitBusyAction): action is 'commit' | 'commit-and-push' {
  return action === 'commit' || action === 'commit-and-push';
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
