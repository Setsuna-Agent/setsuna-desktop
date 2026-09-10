import type { RuntimeConfiguredModelReference, WorkspaceProject } from '@setsuna-desktop/contracts';
import type {
  DesktopDiffSummary,
  DesktopReviewBridge,
  DesktopReviewCommitInput,
  DesktopReviewCommitResult,
  DesktopReviewPullOptions,
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
  useRef,
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
import { useCommitMessageEditor, type CommitMessageEditorLauncher } from './useCommitMessageEditor.js';
import { useAutoResolveGitConflicts } from './useAutoResolveGitConflicts.js';
import { createCommitMessageDocument } from './commit-message-document.js';
import { GitOperationError } from './GitOperationError.js';

type CommitBusyAction = 'commit' | 'amend' | 'commit-and-push' | 'commit-and-sync' | 'create' | 'push' | 'pull' | 'generate-message' | null;
type CommitPhase = 'committing' | 'generating' | null;

type WorkspaceGitCommitDialogContextValue = {
  canOpenCommitDialog: boolean;
  openCommitDialog: () => void;
  messageEditor: ReturnType<typeof useCommitMessageEditor>['editor'];
  conflictTasks: ReturnType<typeof useAutoResolveGitConflicts>['conflictTasks'];
  composer: {
    message: string;
    setMessage: (message: string) => void;
    currentBranch: string;
    available: boolean;
    busy: boolean;
    generating: boolean;
    committing: boolean;
    error: string | null;
    dismissError: () => void;
    generateMessage: () => void;
    commit: () => void;
    commitAndPush: () => void;
    commitAndSync: () => void;
    amend: () => void;
    canAmend: boolean;
    push: () => void;
    pull: (options?: DesktopReviewPullOptions) => void;
  } | null;
};

const workspaceGitCommitDialogDefaultValue: WorkspaceGitCommitDialogContextValue = {
  canOpenCommitDialog: false,
  openCommitDialog: () => undefined,
  messageEditor: null,
  conflictTasks: [],
  composer: null,
};

const WorkspaceGitCommitDialogContext = createContext<WorkspaceGitCommitDialogContextValue>(
  workspaceGitCommitDialogDefaultValue,
);

export function useWorkspaceGitCommitDialog(): WorkspaceGitCommitDialogContextValue {
  return useContext(WorkspaceGitCommitDialogContext);
}

export function WorkspaceGitCommitProvider({
  activeProject,
  threadId,
  conversationModelSelection,
  children,
  reviewLoading,
  reviewState,
  onReviewRefresh,
  onOpenMessageEditor,
}: PropsWithChildren<{
  activeProject?: WorkspaceProject;
  threadId?: string;
  conversationModelSelection?: RuntimeConfiguredModelReference;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  onReviewRefresh?: () => void | Promise<void>;
  onOpenMessageEditor?: CommitMessageEditorLauncher;
}>) {
  const { bridge, notifySuccess, translate: t, ui: { Checkbox } } = useReviewRendererHost();
  const [open, setOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [busyAction, setBusyAction] = useState<CommitBusyAction>(null);
  const [commitPhase, setCommitPhase] = useState<CommitPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const dismissError = () => setError(null);
  const workspaceRoot = activeProject?.path ?? '';
  const { resolveConflicts, conflictTasks } = useAutoResolveGitConflicts({ threadId, workspaceRoot, modelSelection: conversationModelSelection });
  const projectStateKey = activeProject ? `${activeProject.id}:${workspaceRoot}` : '';
  const messageEditor = useCommitMessageEditor(projectStateKey, onOpenMessageEditor);
  const currentProjectKey = useRef(projectStateKey);
  const activeAction = useRef<{ projectKey: string } | null>(null);
  currentProjectKey.current = projectStateKey;
  const currentBranch = reviewState?.currentBranch || 'HEAD';
  const canOpenCommitDialog = Boolean(
    activeProject
      && reviewState?.isGitRepository
      && !reviewLoading,
  );
  const changeStats = useMemo(() => localReviewChangeStats(reviewState), [reviewState]);
  const stagedFileCount = reviewFileCount(reviewState?.stagedSummary);
  const commitableFileCount = includeUnstaged
    ? changeStats.fileCount
    : stagedFileCount;

  const resetDialog = useCallback((nextOpen = false) => {
    setOpen(nextOpen);
    setBranchMenuOpen(false);
    setCommitMessage('');
    setIncludeUnstaged(false);
    setCreatingBranch(false);
    setBranchDraft('');
    setBusyAction(null);
    setCommitPhase(null);
    setError(null);
  }, []);

  const closeDialog = useCallback(() => {
    if (busyAction) return;
    setOpen(false);
    setIncludeUnstaged(false);
    setBranchMenuOpen(false);
    setCreatingBranch(false);
    setBranchDraft('');
    setError(null);
  }, [busyAction]);

  const openCommitDialog = useCallback(() => {
    if (!canOpenCommitDialog) return;
    setOpen(true);
    setError(null);
  }, [canOpenCommitDialog]);

  useEffect(() => {
    activeAction.current = null;
    resetDialog(false);
    return () => { activeAction.current = null; };
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
    task: (api: DesktopReviewBridge, isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (!workspaceRoot || activeAction.current?.projectKey === projectStateKey) return;
    const api = bridge;
    if (!api) {
      setError(t('feature.review.git.unsupported'));
      return;
    }
    const request = { projectKey: projectStateKey };
    activeAction.current = request;
    // Project navigation must not apply a late AI response or clear a newer action.
    const isCurrent = () => currentProjectKey.current === projectStateKey && activeAction.current === request;
    setBusyAction(action);
    setError(null);
    // A failed pull may still update remote refs or leave conflict files to display.
    let shouldRefresh = action === 'pull';
    try {
      await task(api, isCurrent);
      shouldRefresh = action !== 'generate-message';
    } catch (unknownError) {
      if (isCurrent()) setError(gitControlErrorMessage(unknownError, t));
    } finally {
      if (isCurrent() && shouldRefresh) {
        try {
          await onReviewRefresh?.();
        } catch (refreshError) {
          if (isCurrent()) setError((current) => current ?? gitControlErrorMessage(refreshError, t));
        }
      }
      if (isCurrent()) {
        activeAction.current = null;
        setBusyAction(null);
        setCommitPhase(null);
      }
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
    void runGitAction('create', async (api, isCurrent) => {
      await api.createBranch(workspaceRoot, branchName, {
        allowUnstaged: true,
      });
      if (!isCurrent()) return;
      setBranchMenuOpen(false);
      closeBranchCreate();
    });
  };

  // Including working changes is an explicit dialog action, never a shared sidebar preference.
  const generateDraft = (api: DesktopReviewBridge, includeUnstaged: boolean, isCurrent: () => boolean) => (
    api.generateCommitMessage(workspaceRoot, {
      includeUnstaged,
      ...(conversationModelSelection ? { modelSelection: conversationModelSelection } : {}),
    }, (message) => { if (isCurrent()) setCommitMessage(message); })
  );

  const commitChanges = ({ push = false, sync = false, amend = false, includeUnstaged = false }: {
    push?: boolean;
    sync?: boolean;
    amend?: boolean;
    includeUnstaged?: boolean;
  } = {}) => {
    const action = amend ? 'amend' : sync ? 'commit-and-sync' : push ? 'commit-and-push' : 'commit';
    void runGitAction(action, async (api, isCurrent) => {
      let message = commitMessage.trim();
      let amendTarget: DesktopReviewCommitInput['amend'];
      if (amend) {
        const previous = await api.getCommitMessage(workspaceRoot);
        if (!isCurrent()) return;
        // A new commit draft may contain only a subject; amend must start with the full HEAD message.
        const edited = await messageEditor.edit(createCommitMessageDocument(previous, t));
        if (!isCurrent() || edited === null) return;
        message = edited.trim();
        setCommitMessage(message);
        amendTarget = { oid: previous.oid, branch: previous.branch };
      } else if (!message) {
        setCommitPhase('generating');
        const generated = await generateDraft(api, includeUnstaged, isCurrent);
        if (!isCurrent()) return;
        message = generated.message.trim();
        if (!message) throw new Error(t('feature.review.git.messageGenerationFailed'));
        setCommitMessage(message);
      }
      setCommitPhase('committing');
      const result = await api.commit(workspaceRoot, {
        includeUnstaged, message, push,
        ...(sync ? { sync: true } : {}),
        ...(amendTarget ? { amend: amendTarget } : {}),
      });
      if (!isCurrent()) return;
      setBranchMenuOpen(false);
      if (result.pushError || result.syncError) {
        setCommitMessage('');
        const failureMessage = t(result.syncError ? 'feature.review.git.syncAfterCommitFailed' : 'feature.review.git.pushAfterCommitFailed', {
          hash: result.commitHash || t('feature.review.git.commitFinished'),
          error: result.syncError ?? result.pushError ?? '',
        });
        if (result.syncError) {
          const resolution = await resolveConflicts('sync');
          if (isCurrent()) {
            // Starting a repair does not restore saved local work; retain its recovery instructions.
            setError(resolution.error ? `${failureMessage}\n${resolution.error}` : failureMessage);
          }
        } else setError(failureMessage);
        return;
      }
      resetDialog(false);
      notifySuccess(sync ? t('feature.review.git.commitSyncSuccess') : commitSuccessMessage(result, push, t));
    });
  };

  const pushBranch = () => {
    void runGitAction('push', async (api, isCurrent) => {
      await api.push(workspaceRoot);
      if (!isCurrent()) return;
      resetDialog(false);
      notifySuccess(t('feature.review.git.pushSuccess', { branch: currentBranch }));
    });
  };

  const pullBranch = (options: DesktopReviewPullOptions = {}) => {
    void runGitAction('pull', async (api, isCurrent) => {
      try {
        await api.pull(workspaceRoot, options);
      } catch (pullError) {
        if (isCurrent()) {
          const resolution = await resolveConflicts(options.rebase ? 'rebase' : 'pull');
          if (resolution.error) throw new Error(`${gitControlErrorMessage(pullError, t)}\n${resolution.error}`);
        }
        throw pullError;
      }
      if (isCurrent()) notifySuccess(t('feature.review.git.pullSuccess', { branch: currentBranch }));
    });
  };

  const generateMessage = () => {
    void runGitAction('generate-message', async (api, isCurrent) => {
      const generated = await generateDraft(api, false, isCurrent);
      if (!isCurrent()) return;
      const message = generated.message.trim();
      if (!message) throw new Error(t('feature.review.git.messageGenerationFailed'));
      setCommitMessage(message);
    });
  };

  const contextValue: WorkspaceGitCommitDialogContextValue = {
    canOpenCommitDialog,
    openCommitDialog,
    messageEditor: messageEditor.editor,
    conflictTasks,
    composer: {
      message: commitMessage,
      setMessage: setCommitMessage,
      currentBranch,
      available: canOpenCommitDialog && stagedFileCount > 0,
      busy: Boolean(busyAction),
      generating: busyAction === 'generate-message' || commitPhase === 'generating',
      committing: commitPhase === 'committing',
      error,
      dismissError,
      generateMessage,
      commit: () => commitChanges(),
      commitAndPush: () => commitChanges({ push: true }),
      commitAndSync: () => commitChanges({ sync: true }),
      amend: () => commitChanges({ amend: true }),
      canAmend: canOpenCommitDialog && messageEditor.available,
      push: pushBranch,
      pull: pullBranch,
    },
  };

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
                onDismissError={dismissError}
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
            onClick={() => commitChanges({ includeUnstaged })}
          />
          <GitActionButton
            disabled={Boolean(busyAction) || commitableFileCount === 0}
            icon={<GitPullRequestArrow size={14} />}
            loading={busyAction === 'commit-and-push'}
            title={busyAction === 'commit-and-push'
              ? commitPhase === 'generating' ? t('feature.review.git.generatingMessage') : t('feature.review.git.commitAndPushing')
              : t('feature.review.git.commitAndPush')}
            onClick={() => commitChanges({ push: true, includeUnstaged })}
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
          <GitOperationError message={error} onDismiss={dismissError} />
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
  onDismissError,
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
  onDismissError: () => void;
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
      {error ? <GitOperationError message={error} onDismiss={onDismissError} /> : null}
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
