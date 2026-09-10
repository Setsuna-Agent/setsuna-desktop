import { ArrowLeft, Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopDiffFile, DesktopGitCommit, DesktopGitRef, DesktopReviewState } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { useWorkspaceGitCommitDialog } from '../git/WorkspaceGitCommitDialog.js';
import { GitCommitMessageEditor } from '../git/GitCommitMessageEditor.js';
import { ReviewIconButton } from '../primitives.js';
import type { ReviewPathContext } from '../review-types.js';
import { GitChangesFiles, type GitChangesFileGroup } from './GitChangesFiles.js';
import { GitChangesCommitComposer } from './GitChangesCommitComposer.js';
import { GitChangesMenu } from './GitChangesMenu.js';
import { GitChangesSplit } from './GitChangesSplit.js';
import { GitHistoryDiff, type GitHistoryFileActions } from './GitHistoryDiff.js';
import { GitHistoryGraph } from './GitHistoryGraph.js';
import { GitConflictHistory } from './GitConflictHistory.js';
import { GitHistorySplit } from './GitHistorySplit.js';
import { useGitCommitDetails, useGitCommitFile } from './useGitCommit.js';
import { useGitHistory } from './useGitHistory.js';
import { useGitFileActions } from './useGitFileActions.js';

const EMPTY_COMMITS: DesktopGitCommit[] = [];
const EMPTY_REFS: DesktopGitRef[] = [];
const EMPTY_FILES: DesktopDiffFile[] = [];

export type GitChangesPanelProps = {
  workspaceRoot: string;
  editingMessage?: boolean;
  reviewState: DesktopReviewState | null;
  reviewError: string | null;
  reviewLoading: boolean;
  onRefresh: () => void;
  actions: GitHistoryFileActions;
};

/** Remount only when the workspace changes; browsing commits never changes checkout. */
export function GitChangesPanel(props: GitChangesPanelProps) {
  return <GitChangesWorkspace key={props.workspaceRoot} {...props} />;
}

function GitChangesWorkspace({ workspaceRoot, editingMessage = false, reviewState, reviewError, reviewLoading, onRefresh, actions }: GitChangesPanelProps) {
  const { bridge, translate: t, ui: { ConflictTaskProgress } } = useReviewRendererHost();
  const { composer, messageEditor, conflictTasks } = useWorkspaceGitCommitDialog();
  const showMessageEditor = editingMessage && Boolean(messageEditor);
  const history = useGitHistory(workspaceRoot, reviewState);
  const fileActions = useGitFileActions(workspaceRoot, onRefresh);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [worktreeSelection, setWorktreeSelection] = useState<{ source: 'staged' | 'unstaged'; path: string | null } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const latestConflict = conflictTasks[0];
  const lastOpenedConflictId = useRef<string | null>(null);
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const conflictTask = conflictTasks.find((task) => task.turnId === selectedConflictId);
  useEffect(() => {
    if (!latestConflict || lastOpenedConflictId.current === latestConflict.turnId) return;
    lastOpenedConflictId.current = latestConflict.turnId;
    // Only new records open automatically; archiving/restoring must not reopen
    // a hidden record or replace the user's current file/commit selection.
    if (!latestConflict.archived) {
      setSelectedConflictId(latestConflict.turnId); setDetailOpen(true); setSelectedOid(null);
    }
  }, [latestConflict]);
  const details = useGitCommitDetails(workspaceRoot, selectedOid);
  const commitFile = details.data?.files.find((file) => file.path === selectedPath) ?? details.data?.files[0] ?? null;
  const diff = useGitCommitFile(workspaceRoot, selectedOid, commitFile);
  const source = worktreeSelection?.source ?? 'unstaged';
  const worktreeFiles = source === 'staged' ? reviewState?.stagedSummary?.files : reviewState?.unstagedSummary?.files;
  const worktreeFile = worktreeFiles?.find((file) => file.path === worktreeSelection?.path) ?? null;
  const files = useMemo(() => {
    if (selectedOid) return diff.data ? [diff.data] : EMPTY_FILES;
    if (worktreeSelection?.path === null) return worktreeFiles ?? EMPTY_FILES;
    return worktreeFile ? [worktreeFile] : EMPTY_FILES;
  }, [diff.data, selectedOid, worktreeFile, worktreeFiles, worktreeSelection?.path]);
  const page = history.page;
  const refs = page?.refs ?? EMPTY_REFS;
  const selectCommit = useCallback((oid: string) => {
    setSelectedConflictId(null);
    setSelectedOid(oid);
    setSelectedPath(null);
    setDetailOpen(true);
  }, []);
  const selectRef = useCallback((ref: DesktopGitRef) => {
    history.selectRef(ref.name);
    selectCommit(ref.oid);
  }, [history.selectRef, selectCommit]);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const pathContext = useMemo<ReviewPathContext>(() => ({
    workspaceRoot,
    gitRoot: page?.gitRoot ?? reviewState?.gitRoot,
    source: selectedOid ? 'commit' : source,
    ...(details.data ? { revisions: { before: details.data.baseOid, after: details.data.commit.oid } } : {}),
  }), [details.data, page?.gitRoot, reviewState?.gitRoot, selectedOid, source, workspaceRoot]);
  const groups: GitChangesFileGroup[] = selectedOid
    ? [{
      id: 'commit',
      label: details.data?.commit.subject || page?.commits.find((commit) => commit.oid === selectedOid)?.subject || t('feature.review.history.loading'),
      description: selectedOid.slice(0, 8),
      files: details.data?.files ?? [],
    }]
    : [
      { id: 'staged', label: t('feature.review.history.staged'), files: reviewState?.stagedSummary?.files ?? [] },
      { id: 'unstaged', label: t('feature.review.history.changes'), files: reviewState?.unstagedSummary?.files ?? [] },
    ];
  const refresh = () => { fileActions.clearError(); onRefresh(); history.refresh(); };
  const retryDiff = () => { if (details.error) details.retry(); else if (selectedOid) diff.retry(); else refresh(); };
  const emptyRepository = page && !page.gitRoot;

  if (!bridge) return <div className="git-history-status">{t('feature.review.git.unsupported')}</div>;
  if (emptyRepository) return <div className="git-history-status">{t('feature.review.history.noGit')}</div>;

  return (
    <section className="desktop-review-panel git-changes-panel" aria-label={t('feature.review.history.title')}>
      <GitChangesSplit detailOpen={detailOpen} editingMessage={showMessageEditor} navigation={
        <nav className={'git-changes-nav' + (changesExpanded ? '' : ' is-collapsed')} aria-label={t('feature.review.history.title')}>
          <div className="git-changes-nav__header">
            <button className="git-changes-nav__title" type="button" aria-expanded={changesExpanded} onClick={() => setChangesExpanded((value) => !value)}>
              <ChevronDown size={12} className={changesExpanded ? '' : 'is-collapsed'} />{t('feature.review.history.changes')}
            </button>
            <ReviewIconButton className="app-shell-icon-control" label={t('feature.review.git.commit')} disabled={fileActions.busy || !composer?.available || composer.busy || !composer.message.trim()} onClick={composer?.commit}><Check size={16} /></ReviewIconButton>
            <ReviewIconButton className="app-shell-icon-control" label={t('feature.review.workspace.refresh')} onClick={refresh} disabled={history.loading || reviewLoading}><RefreshCw size={13} /></ReviewIconButton>
            <GitChangesMenu refs={refs} selectedRef={history.selectedRef} filterVisible={filterVisible} busy={fileActions.busy} onToggleFilter={() => { setFilterVisible((value) => !value); setChangesExpanded(true); }} currentBranch={page?.currentBranch ?? reviewState?.currentBranch ?? null} onSelectRef={selectRef} onSelectHead={() => {
              history.selectRef('');
              if (page?.head) selectCommit(page.head);
            }} />
          </div>
          {changesExpanded ? <GitChangesCommitComposer blocked={fileActions.busy} /> : null}
          {changesExpanded && selectedOid ? <div className="git-changes-nav__workspace">
            <button type="button" aria-pressed={!selectedOid} onClick={() => { setSelectedOid(null); setDetailOpen(false); }}>
              <ArrowLeft size={13} /><span>{t('feature.review.history.workspace')}</span>
            </button>
          </div> : null}
          <GitHistorySplit
            files={changesExpanded ? (
              <GitChangesFiles
                groups={groups}
                pathContext={pathContext}
                filterVisible={filterVisible}
                selectedKey={selectedOid ? 'commit:' + commitFile?.path : worktreeSelection ? source + ':' + worktreeSelection.path : null}
                loading={selectedOid ? details.loading : reviewLoading}
                error={selectedOid ? details.error : fileActions.error ?? reviewError}
                busy={fileActions.busy || Boolean(composer?.busy)}
                onOpen={actions.onOpenProjectFile}
                onOpenGroup={(group) => {
                  if (group !== 'staged' && group !== 'unstaged') return;
                  setSelectedConflictId(null);
                  setWorktreeSelection({ source: group, path: null });
                  setDetailOpen(true);
                }}
                onAction={async (action, selectedFiles) => {
                  if (composer?.busy || !await fileActions.run(action, selectedFiles)) return;
                  setWorktreeSelection((current) => {
                    if (!current || current.path === null || !selectedFiles.some((entry) => entry.path === current.path)) return current;
                    return action === 'discard' ? null : { path: current.path, source: action === 'stage' ? 'staged' : 'unstaged' };
                  });
                }}
                onRetry={selectedOid ? details.retry : refresh}
                onSelect={(group, selectedFile) => {
                  setSelectedConflictId(null);
                  if (group === 'commit') setSelectedPath(selectedFile.path);
                  else if (group === 'staged' || group === 'unstaged') setWorktreeSelection({ source: group, path: selectedFile.path });
                  setDetailOpen(true);
                }}
              />
            ) : null}
            conflicts={conflictTasks.length ? <GitConflictHistory workspaceRoot={workspaceRoot} tasks={conflictTasks} selectedTurnId={selectedConflictId} onSelect={(turnId) => {
              setSelectedConflictId(turnId); setSelectedOid(null); setDetailOpen(Boolean(turnId));
            }} /> : null}
            graph={(
              <GitHistoryGraph
                workspaceRoot={workspaceRoot}
                commits={page?.commits ?? EMPTY_COMMITS}
                refs={refs}
                head={page?.head ?? null}
                selectedOid={selectedOid}
                loading={history.loading || history.loadingMore}
                hasMore={page?.nextSkip != null}
                error={history.error}
                onSelect={selectCommit}
                onSelectRef={selectRef}
                onLoadMore={() => void history.loadMore()}
                onRetry={history.refresh}
              />
            )}
          />
        </nav>
      }>
        {showMessageEditor ? <GitCommitMessageEditor /> : conflictTask ? <ConflictTaskProgress
          key={conflictTask.turnId}
          {...conflictTask}
          workspaceRoot={workspaceRoot}
          onBack={() => { setSelectedConflictId(null); closeDetail(); }}
          onFinished={refresh}
          onOpenWorkspaceFile={actions.onOpenProjectFile}
        /> : <GitHistoryDiff
          files={files}
          details={details.data}
          pathContext={pathContext}
          selectionKey={JSON.stringify([workspaceRoot, selectedOid ?? source, selectedOid ? commitFile?.path : worktreeSelection?.path])}
          loading={selectedOid ? details.loading || diff.loading : reviewLoading && !files.length}
          error={selectedOid ? details.error ?? diff.error : reviewError}
          actions={actions}
          onRetry={retryDiff}
          onBack={closeDetail}
        />}
      </GitChangesSplit>
    </section>
  );
}
