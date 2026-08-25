import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type {
  DesktopDiffSummary,
  DesktopReviewBridge,
  DesktopReviewCommitResult,
  DesktopReviewState,
} from '../../contracts/index.js';
import {
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useReviewRendererHost } from '../host.js';
import type { ReviewTranslate } from '../messages.js';
import { ReviewChangeCounts } from '../ReviewChangeCounts.js';
import { localReviewChangeStats } from '../reviewChanges.js';
import { WorkspaceGitBranchCreateControl } from './WorkspaceGitBranchCreateControl.js';

type CommitBusyAction = 'commit' | 'commit-and-push' | 'create' | 'push' | null;
type CommitPhase = 'committing' | 'generating' | null;

type WorkspaceGitCommitDialogContextValue = {
  canOpenCommitDialog: boolean;
  openCommitDialog: () => void;
};

const workspaceGitCommitDialogDefaultValue: WorkspaceGitCommitDialogContextValue = {
  canOpenCommitDialog: false,
  openCommitDialog: () => undefined,
};

const WorkspaceGitCommitDialogContext = createContext<WorkspaceGitCommitDialogContextValue>(
  workspaceGitCommitDialogDefaultValue,
);

export function useWorkspaceGitCommitDialog(): WorkspaceGitCommitDialogContextValue {
  return useContext(WorkspaceGitCommitDialogContext);
}

export function WorkspaceGitCommitProvider({
  activeProject,
  children,
  reviewLoading,
  reviewState,
  onReviewRefresh,
}: PropsWithChildren<{
  activeProject?: WorkspaceProject;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  onReviewRefresh?: () => void | Promise<void>;
}>) {
  const { bridge, notifySuccess, translate: t, ui: { Checkbox } } = useReviewRendererHost();
  const [open, setOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [busyAction, setBusyAction] = useState<CommitBusyAction>(null);
  const [commitPhase, setCommitPhase] = useState<CommitPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const workspaceRoot = activeProject?.path ?? '';
  const projectStateKey = activeProject ? `${activeProject.id}:${workspaceRoot}` : '';
  const currentBranch = reviewState?.currentBranch || 'HEAD';
  const canOpenCommitDialog = Boolean(
    activeProject
      && reviewState?.isGitRepository
      && !reviewLoading,
  );
  const changeStats = useMemo(() => localReviewChangeStats(reviewState), [reviewState]);
  const commitableFileCount = includeUnstaged
    ? changeStats.fileCount
    : reviewFileCount(reviewState?.stagedSummary);

  const resetDialog = useCallback((nextOpen = false) => {
    setOpen(nextOpen);
    setBranchMenuOpen(false);
    setCommitMessage('');
    setIncludeUnstaged(true);
    setCreatingBranch(false);
    setBranchDraft('');
    setBusyAction(null);
    setCommitPhase(null);
    setError(null);
  }, []);

  const closeDialog = useCallback(() => {
    if (busyAction) return;
    resetDialog(false);
  }, [busyAction, resetDialog]);

  const openCommitDialog = useCallback(() => {
    if (!canOpenCommitDialog) return;
    resetDialog(true);
  }, [canOpenCommitDialog, resetDialog]);

  useEffect(() => {
    resetDialog(false);
  }, [projectStateKey, resetDialog]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDialog();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, open]);

  const runGitAction = async (
    action: CommitBusyAction,
    task: (api: DesktopReviewBridge) => Promise<void>,
  ) => {
    if (!workspaceRoot || busyAction) return;
    const api = bridge;
    if (!api) {
      setError(t('feature.review.git.unsupported'));
      return;
    }
    setBusyAction(action);
    setError(null);
    try {
      await task(api);
      await onReviewRefresh?.();
    } catch (unknownError) {
      setError(gitControlErrorMessage(unknownError, t));
    } finally {
      setBusyAction(null);
      if (action === 'commit' || action === 'commit-and-push') setCommitPhase(null);
    }
  };

  const closeBranchCreate = () => {
    setCreatingBranch(false);
    setBranchDraft('');
  };

  const createBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branchName = branchDraft.trim();
    if (!branchName) {
      setError(t('feature.review.git.branchRequired'));
      return;
    }
    void runGitAction('create', async (api) => {
      await api.createBranch(workspaceRoot, branchName, {
        allowUnstaged: true,
      });
      setBranchMenuOpen(false);
      closeBranchCreate();
    });
  };

  const commitChanges = (push: boolean) => {
    const action = push ? 'commit-and-push' : 'commit';
    void runGitAction(action, async (api) => {
      let message = commitMessage.trim();
      if (!message) {
        setCommitPhase('generating');
        const generated = await api.generateCommitMessage(workspaceRoot, { includeUnstaged });
        message = generated.message.trim();
        if (!message) throw new Error(t('feature.review.git.messageGenerationFailed'));
        setCommitMessage(message);
      }
      setCommitPhase('committing');
      const result = await api.commit(workspaceRoot, { includeUnstaged, message, push });
      setBranchMenuOpen(false);
      if (result.pushError) {
        setCommitMessage('');
        setError(t('feature.review.git.pushAfterCommitFailed', {
          hash: result.commitHash || t('feature.review.git.commitFinished'),
          error: result.pushError,
        }));
        return;
      }
      resetDialog(false);
      notifySuccess(commitSuccessMessage(result, push, t));
    });
  };

  const pushBranch = () => {
    void runGitAction('push', async (api) => {
      await api.push(workspaceRoot);
      resetDialog(false);
      notifySuccess(t('feature.review.git.pushSuccess', { branch: currentBranch }));
    });
  };

  const contextValue = useMemo<WorkspaceGitCommitDialogContextValue>(() => ({
    canOpenCommitDialog,
    openCommitDialog,
  }), [canOpenCommitDialog, openCommitDialog]);

  const dialog = open && typeof document !== 'undefined' ? createPortal(
    <div
      className="chat-git-commit-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        closeDialog();
      }}
    >
      <div
        aria-label={t('feature.review.git.commitOrPush')}
        aria-modal="true"
        className="chat-git-commit-popover"
        role="dialog"
      >
        <div className="chat-git-commit-popover__head">
          <div className="chat-git-commit-popover__branch-wrap">
            <button
              type="button"
              className={`chat-git-commit-popover__branch ${branchMenuOpen ? 'is-open' : ''}`}
              aria-expanded={branchMenuOpen}
              disabled={Boolean(busyAction)}
              onClick={() => {
                setBranchMenuOpen((current) => !current);
                setError(null);
              }}
            >
              <GitBranch size={13} />
              <span>{currentBranch}</span>
              <ChevronDown size={12} />
            </button>
            {branchMenuOpen ? (
              <CommitBranchMenu
                branchDraft={branchDraft}
                busyAction={busyAction}
                creatingBranch={creatingBranch}
                currentBranch={currentBranch}
                error={error}
                onBranchDraftChange={setBranchDraft}
                onCancelCreate={closeBranchCreate}
                onCreate={createBranch}
                onCreateStart={() => {
                  setCreatingBranch(true);
                  setError(null);
                }}
                t={t}
              />
            ) : null}
          </div>
          <ReviewChangeCounts additions={changeStats.additions} deletions={changeStats.deletions} />
        </div>
        <textarea
          className="chat-git-commit-popover__message"
          value={commitMessage}
          rows={3}
          placeholder={t('feature.review.git.messagePlaceholder')}
          disabled={Boolean(busyAction)}
          onChange={(event) => setCommitMessage(event.currentTarget.value)}
        />
        <Checkbox
          checked={includeUnstaged}
          className="chat-git-commit-popover__check"
          disabled={Boolean(busyAction)}
          onChange={setIncludeUnstaged}
        >
          {t('feature.review.git.includeUnstaged')}
        </Checkbox>
        <div className="chat-git-commit-popover__divider" />
        <div className="chat-git-commit-popover__actions">
          <GitActionButton
            disabled={Boolean(busyAction) || commitableFileCount === 0}
            icon={<GitCommitHorizontal size={14} />}
            loading={busyAction === 'commit'}
            title={busyAction === 'commit'
              ? commitPhase === 'generating' ? t('feature.review.git.generatingMessage') : t('feature.review.git.committing')
              : t('feature.review.git.commit')}
            onClick={() => commitChanges(false)}
          />
          <GitActionButton
            disabled={Boolean(busyAction) || commitableFileCount === 0}
            icon={<GitPullRequestArrow size={14} />}
            loading={busyAction === 'commit-and-push'}
            title={busyAction === 'commit-and-push'
              ? commitPhase === 'generating' ? t('feature.review.git.generatingMessage') : t('feature.review.git.commitAndPushing')
              : t('feature.review.git.commitAndPush')}
            onClick={() => commitChanges(true)}
          />
          <GitActionButton
            disabled={Boolean(busyAction)}
            icon={<UploadCloud size={14} />}
            loading={busyAction === 'push'}
            title={t('feature.review.git.push')}
            onClick={pushBranch}
          />
        </div>
        {error && !branchMenuOpen ? (
          <div className="chat-git-commit-popover__error">{error}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <WorkspaceGitCommitDialogContext.Provider value={contextValue}>
      {children}
      {dialog}
    </WorkspaceGitCommitDialogContext.Provider>
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
  busyAction: CommitBusyAction;
  creatingBranch: boolean;
  currentBranch: string;
  error: string | null;
  onBranchDraftChange: (value: string) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStart: () => void;
  t: ReviewTranslate;
}) {
  return (
    <div className="chat-git-commit-branch-menu">
      <div className="chat-git-commit-branch-menu__label">{t('feature.review.git.commitTo')}</div>
      <div className="chat-git-commit-branch-menu__item is-current">
        <GitBranch size={14} />
        <span>{currentBranch}</span>
        <Check size={13} />
      </div>
      <WorkspaceGitBranchCreateControl
        branchDraft={branchDraft}
        busy={Boolean(busyAction)}
        compact
        creatingBranch={creatingBranch}
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

function GitActionButton({
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
      <span className="chat-git-commit-popover__action-icon">
        {loading ? <Loader2 className="chat-git-loading-icon" size={14} /> : icon}
      </span>
      <span>{title}</span>
    </button>
  );
}

function commitSuccessMessage(
  result: Pick<DesktopReviewCommitResult, 'commitHash'>,
  pushed: boolean,
  t?: ReviewTranslate,
): string {
  const action = t
    ? t(pushed ? 'feature.review.git.commitPushSuccess' : 'feature.review.git.commitSuccess')
    : pushed ? '提交并推送成功' : '提交成功';
  return result.commitHash ? `${action} · ${result.commitHash}` : action;
}

function reviewFileCount(summary: DesktopDiffSummary | null | undefined): number {
  return summary?.files.length ?? 0;
}

function gitControlErrorMessage(error: unknown, t: ReviewTranslate): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = rawMessage.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/u, '');
  const withoutRuntimePath = withoutIpcPrefix.replace(/\s*\((?:GET|POST|PUT|PATCH|DELETE)\s+\/v\d+\/[^)]+\)\s*$/u, '');
  return withoutRuntimePath.trim() || t('feature.review.git.operationFailed');
}
