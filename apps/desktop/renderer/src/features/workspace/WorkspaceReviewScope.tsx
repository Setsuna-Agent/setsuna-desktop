import { workspaceProjectForRoot, workspaceProjectRoots, type RuntimeConfiguredModelReference, type WorkspaceProject, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react';
import {
  ReviewFeatureGitCommitProvider, ReviewFeatureGitCommitScope, useReviewFeatureGitCommit, useReviewFeatureState,
  type CommitMessageEditorLauncher,
} from '../../composition/review-feature-adapter.js';
import type { DesktopPanelTab } from './model.js';
import type { WorkspacePanel } from './WorkspacePanel.js';

type ReviewProps = Pick<ComponentProps<typeof WorkspacePanel>,
  'reviewState' | 'reviewError' | 'reviewLoading' | 'onReviewRefresh' | 'onReviewBaseRefChange' | 'onReviewSourceChange'>;
type Scope = { review: ReviewProps; git: ReturnType<typeof useReviewFeatureGitCommit> };
type ScopeProps = PropsWithChildren<{
  project?: WorkspaceProject;
  panels: DesktopPanelTab[];
  threadId?: string;
  modelSelection?: RuntimeConfiguredModelReference;
  onOpenMessageEditor?: (events: Parameters<CommitMessageEditorLauncher>[0], rootId?: string) => () => void;
}>;
const ReviewScopesContext = createContext<Record<string, Scope>>({});
const isReviewPanel = (panel: DesktopPanelTab) => ['review', 'changes', 'commit-message'].includes(panel.type);

/** Controllers belong to directories, so moving/hiding a tab never disposes its pending Git action or draft. */
export function WorkspaceReviewScopes({ children, ...props }: ScopeProps) {
  const primary = useReviewFeatureGitCommit();
  return <SecondaryScopes {...props} roots={workspaceProjectRoots(props.project).slice(1)}>
    <ReviewFeatureGitCommitScope value={primary}>{children}</ReviewFeatureGitCommitScope>
  </SecondaryScopes>;
}

function SecondaryScopes({ roots, children, ...props }: ScopeProps & { roots: WorkspaceProjectRoot[] }) {
  const root = roots[0];
  if (!root || !props.project) return children;
  return <DirectoryScope {...props} project={props.project} root={root} key={`${props.project.id}:${root.id}:${root.path}`}>
    <SecondaryScopes {...props} roots={roots.slice(1)}>{children}</SecondaryScopes>
  </DirectoryScope>;
}

function DirectoryScope({ project, root, panels, threadId, modelSelection, onOpenMessageEditor, children }: ScopeProps & { project: WorkspaceProject; root: WorkspaceProjectRoot }) {
  const selected = panels.some((panel) => isReviewPanel(panel) && panel.rootId === root.id);
  const [visited, setVisited] = useState(selected);
  useEffect(() => { if (selected) setVisited(true); }, [selected]);
  const scopedProject = useMemo(() => workspaceProjectForRoot(project, root.id), [project, root.id]);
  // Additional repositories are loaded only after a panel selects them, keeping startup free of directory scans.
  const activeProject = selected || visited ? scopedProject : undefined;
  const state = useReviewFeatureState({ activeProject });
  const openMessageEditor = useCallback<CommitMessageEditorLauncher>((events) =>
    onOpenMessageEditor?.(events, root.id) ?? (() => undefined), [onOpenMessageEditor, root.id]);
  const review = useMemo<ReviewProps>(() => ({
    reviewState: state.reviewState, reviewError: state.reviewError, reviewLoading: state.reviewLoading,
    onReviewRefresh: state.loadReviewState, onReviewBaseRefChange: state.selectReviewBaseRef,
    onReviewSourceChange: state.setReviewSource,
  }), [state.reviewState, state.reviewError, state.reviewLoading, state.loadReviewState, state.selectReviewBaseRef, state.setReviewSource]);
  return <ReviewFeatureGitCommitProvider
    activeProject={activeProject} threadId={threadId} conversationModelSelection={modelSelection}
    reviewState={state.reviewState} reviewLoading={state.reviewLoading}
    onReviewRefresh={state.loadReviewState} onOpenMessageEditor={openMessageEditor}
  ><CaptureScope rootId={root.id} review={review}>{children}</CaptureScope></ReviewFeatureGitCommitProvider>;
}

function CaptureScope({ rootId, review, children }: PropsWithChildren<{ rootId: string; review: ReviewProps }>) {
  const parent = useContext(ReviewScopesContext);
  const git = useReviewFeatureGitCommit();
  const scopes = useMemo(() => ({ ...parent, [rootId]: { review, git } }), [parent, rootId, review, git]);
  return <ReviewScopesContext.Provider value={scopes}>{children}</ReviewScopesContext.Provider>;
}

/** The conversation keeps its primary Git controls; each panel selects its own directory's controller. */
export function WorkspaceReviewScope({ panel, children }: {
  panel: DesktopPanelTab;
  children(review: Partial<ReviewProps>): ReactNode;
}) {
  const scopes = useContext(ReviewScopesContext);
  const scope = panel.rootId && isReviewPanel(panel) ? scopes[panel.rootId] : undefined;
  return scope ? <ReviewFeatureGitCommitScope value={scope.git}>{children(scope.review)}</ReviewFeatureGitCommitScope> : children({});
}
