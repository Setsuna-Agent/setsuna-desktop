import { workspaceProjectForRoot, workspaceProjectRoots, type RuntimeConfiguredModelReference, type WorkspaceProject, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react';
import {
  ReviewFeatureGitCommitProvider, ReviewFeatureGitCommitScope, useReviewFeatureGitCommit, useReviewFeatureState,
  type CommitMessageEditorLauncher,
} from '../../composition/review-feature-adapter.js';
import type { DesktopPanelTab } from './model.js';
import type { WorkspacePanel } from './WorkspacePanel.js';

type ReviewProps = Pick<ComponentProps<typeof WorkspacePanel>,
  'reviewState' | 'reviewError' | 'reviewLoading' | 'onReviewRefresh' | 'onReviewBaseRefChange' | 'onReviewSourceChange'>;
type Scope = { review: ReviewProps; git: ReturnType<typeof useReviewFeatureGitCommit> };
type RegisterScope = (key: string, scope: Scope) => () => void;
type ScopeProps = PropsWithChildren<{
  project?: WorkspaceProject;
  panels: DesktopPanelTab[];
  threadId?: string;
  modelSelection?: RuntimeConfiguredModelReference;
  onOpenMessageEditor?: (events: Parameters<CommitMessageEditorLauncher>[0], rootId?: string) => () => void;
}>;
const ReviewScopesContext = createContext<{ scopes: Record<string, Scope>; project?: WorkspaceProject }>({ scopes: {} });
const RegisterScopeContext = createContext<RegisterScope>(() => () => undefined);
const isReviewPanel = (panel: DesktopPanelTab) => ['review', 'changes', 'commit-message'].includes(panel.type);

/** Controllers belong to directories, so moving/hiding a tab never disposes its pending Git action or draft. */
export function WorkspaceReviewScopes({ children, ...props }: ScopeProps) {
  const primary = useReviewFeatureGitCommit();
  const project = props.project;
  // Directory controllers may come and go, but cached panels must keep a stable ancestry.
  return <ScopeRegistry project={project}>
    {project && workspaceProjectRoots(project).slice(1).map((root) =>
      <DirectoryScope {...props} project={project} root={root} key={scopeKey(project, root)} />)}
    <ReviewFeatureGitCommitScope value={primary}>{children}</ReviewFeatureGitCommitScope>
  </ScopeRegistry>;
}

function ScopeRegistry({ project, children }: PropsWithChildren<{ project?: WorkspaceProject }>) {
  const [registered, setRegistered] = useState<Record<string, Scope>>({});
  const register = useCallback<RegisterScope>((key, scope) => {
    setRegistered((current) => ({ ...current, [key]: scope }));
    return () => setRegistered((current) => {
      if (current[key] !== scope) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ scopes: registered, project }), [registered, project]);
  // Snapshot updates reach panel consumers without rendering the publishing controllers again.
  return <RegisterScopeContext.Provider value={register}>
    <ReviewScopesContext.Provider value={value}>{children}</ReviewScopesContext.Provider>
  </RegisterScopeContext.Provider>;
}

function scopeKey(project: WorkspaceProject, root: WorkspaceProjectRoot): string {
  return JSON.stringify([project.id, root.id, root.path]);
}

function DirectoryScope({ project, root, panels, threadId, modelSelection, onOpenMessageEditor }: ScopeProps & {
  project: WorkspaceProject; root: WorkspaceProjectRoot;
}) {
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
  ><CaptureScope scopeId={scopeKey(project, root)} review={review} /></ReviewFeatureGitCommitProvider>;
}

function CaptureScope({ scopeId, review }: { scopeId: string; review: ReviewProps }) {
  const register = useContext(RegisterScopeContext);
  const git = useReviewFeatureGitCommit();
  // Publish before paint so a secondary panel never briefly offers the primary repository's actions.
  useLayoutEffect(() => register(scopeId, { review, git }), [scopeId, review, git, register]);
  return null;
}

/** The conversation keeps its primary Git controls; each panel selects its own directory's controller. */
export function WorkspaceReviewScope({ panel, children }: {
  panel: DesktopPanelTab;
  children(review: Partial<ReviewProps>): ReactNode;
}) {
  const { scopes, project } = useContext(ReviewScopesContext);
  const primary = useReviewFeatureGitCommit();
  const root = panel.rootId && isReviewPanel(panel) ? workspaceProjectRoots(project).find((item) => item.id === panel.rootId) : undefined;
  const scope = project && root ? scopes[scopeKey(project, root)] : undefined;
  return <ReviewFeatureGitCommitScope value={scope?.git ?? primary}>{children(scope?.review ?? {})}</ReviewFeatureGitCommitScope>;
}
