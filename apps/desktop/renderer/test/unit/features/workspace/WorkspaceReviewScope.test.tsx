// @vitest-environment happy-dom
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { RuntimeMessage, RuntimeToolRun, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopReviewState } from '@setsuna-desktop/feature-review/contracts';
import { reviewRendererFeature } from '@setsuna-desktop/feature-review/renderer';
import { WorkspaceGitCommitProvider, useWorkspaceGitCommitDialog } from '@setsuna-desktop/feature-review/renderer/git';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../../src/composition/review-feature-adapter.js';
import { WorkspaceReviewScope, WorkspaceReviewScopes } from '../../../../src/features/workspace/WorkspaceReviewScope.js';
import { latestDesktopReviewSummaryFromMessages, scopeReviewPaths, scopeReviewSummary } from '../../../../src/features/workspace/runtimeReviewSummary.js';
import type { DesktopPanelTab } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it('projects primary-relative tool paths into nested and sibling review directories', () => {
  const project: WorkspaceProject = { id: 'project', name: 'Workspace', path: '/repo', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'nested', path: '/repo/agent' }, { id: 'sibling', path: '/sibling' }],
  };
  const paths = [{ path: 'agent/file.ts' }, { path: '../sibling/file.ts' }, { path: '/external/file.ts' }];
  expect(scopeReviewPaths(paths, project, 'main')).toEqual([{ path: 'agent/file.ts' }]);
  expect(scopeReviewPaths(paths, project, 'nested')).toEqual([{ path: 'file.ts' }]);
  expect(scopeReviewPaths(paths, project, 'sibling')).toEqual([{ path: 'file.ts' }]);
});

it('keeps latest changes assigned to their recorded directories after promotion and worktree relocation', () => {
  const project: WorkspaceProject = { id: 'project', name: 'Workspace', path: '/agent', createdAt: '', updatedAt: '',
    roots: [{ id: 'child', path: '/agent' }, { id: 'main', path: '/repo' }],
  };
  const run = (id: string, absolutePath: string, additions: number): RuntimeToolRun => {
    const diff = { path: 'same.txt', absolutePath, additions, deletions: 0, lines: [] };
    return { id, name: 'write_file', status: 'success', resultPreview: JSON.stringify({ diff }), data: { ok: true, diff } };
  };
  const message: RuntimeMessage = { id: 'message', role: 'assistant', content: '', status: 'complete', createdAt: '',
    toolRuns: [run('main-1', '/repo/same.txt', 1), run('child', '/agent/same.txt', 2), run('main-2', '/repo/same.txt', 3)],
  };
  const summary = latestDesktopReviewSummaryFromMessages([message]);
  expect(scopeReviewSummary(summary, project, 'main')).toMatchObject({ files: [{ path: 'same.txt', additions: 4 }], additions: 4 });
  expect(scopeReviewSummary(summary, project, 'child')).toMatchObject({ files: [{ path: 'same.txt', additions: 2 }], additions: 2 });
  expect(summary?.files).toHaveLength(2);

  const forkRun = run('fork', '/repo/same.txt', 1);
  forkRun.data = { ok: true, diff: { path: 'same.txt', absolutePath: '/worktree/same.txt', additions: 1, lines: [] } };
  const forkSummary = latestDesktopReviewSummaryFromMessages([{ ...message, toolRuns: [forkRun] }]);
  expect(scopeReviewSummary(forkSummary, project, 'main')).toBeNull();
  expect(scopeReviewSummary(forkSummary, { ...project, path: '/worktree', roots: [{ id: 'main', path: '/worktree' }] }, 'main'))
    .toMatchObject({ files: [{ path: 'same.txt', additions: 1 }] });
});

it('keeps cached panel sessions alive while directories are added, reordered, removed or replaced', () => {
  const primary = { id: 'main', path: '/repo' };
  const child = { id: 'child', path: '/agent' };
  const project: WorkspaceProject = { id: 'project', name: 'Workspace', path: primary.path,
    createdAt: '', updatedAt: '', roots: [primary],
  };
  const disposed = vi.fn();
  let session!: { draft: string; edit: (value: string) => void };
  function CachedPanel() {
    const [draft, edit] = useState('');
    session = { draft, edit };
    useEffect(() => disposed, []);
    return null;
  }
  function Workspace({ project: current }: { project?: WorkspaceProject }) {
    return <ToastProvider><ReviewFeatureHostBoundary><WorkspaceReviewScopes project={current} panels={[]}>
      <WorkspaceReviewScope panel={{ id: 'changes', type: 'changes', rootId: 'child' }}>
        {() => <CachedPanel />}
      </WorkspaceReviewScope>
    </WorkspaceReviewScopes></ReviewFeatureHostBoundary></ToastProvider>;
  }
  const view = render(<Workspace project={project} />);
  act(() => session.edit('Unsaved page state'));
  for (const current of [
    { ...project, roots: [primary, child] },
    { ...project, path: child.path, roots: [child, primary] },
    project,
    undefined,
    { ...project, id: 'another-project', roots: [primary, child] },
  ]) {
    view.rerender(<Workspace project={current} />);
    expect(session.draft).toBe('Unsaved page state');
    expect(disposed).not.toHaveBeenCalled();
  }
  view.unmount();
  expect(disposed).toHaveBeenCalledOnce();
});

it('loads secondary review on demand and keeps one amend controller across slots while preserving the primary context', async () => {
  const project: WorkspaceProject = { id: 'project', name: 'Workspace', path: '/repo', createdAt: '', updatedAt: '',
    roots: [{ id: 'main', path: '/repo' }, { id: 'child', path: '/agent' }],
  };
  const state: DesktopReviewState = {
    workspaceRoot: '/repo', gitRoot: '/repo', isGitRepository: true, currentBranch: 'main',
    currentRemoteRef: null, baseRef: null, baseRefs: [], branches: [], currentRemoteSummary: null,
    branchSummary: null, stagedSummary: null, unstagedSummary: null,
  };
  const getState = vi.fn(async (root: string) => ({ ...state, workspaceRoot: root, gitRoot: root }));
  const getCommitMessage = vi.fn().mockResolvedValue({ oid: 'a'.repeat(40), branch: 'main', message: 'Original', context: 'On branch main' });
  const commit = vi.fn().mockResolvedValue({ ok: true, commitHash: 'abc123', pushed: false, state });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    desktop: { platform: 'darwin' }, desktopReview: { getState, getCommitMessage, commit, watchChanges: () => () => undefined },
  } });
  type Git = ReturnType<typeof useWorkspaceGitCommitDialog>;
  const snapshots: Record<string, Git> = {};
  let select!: (rootId: string) => void;
  let moveEditor!: () => void;
  function Probe({ name }: { name: string }) { snapshots[name] = useWorkspaceGitCommitDialog(); return null; }
  function Workspace() {
    const [rootId, setRootId] = useState('main');
    const [editor, setEditor] = useState<DesktopPanelTab | null>(null);
    const [bottom, setBottom] = useState(false);
    select = setRootId;
    moveEditor = () => setBottom(true);
    const panel: DesktopPanelTab = { id: 'changes', type: 'changes', rootId };
    const editorView = editor && <WorkspaceReviewScope panel={editor}>{() => <Probe name="editor" />}</WorkspaceReviewScope>;
    return <WorkspaceGitCommitProvider activeProject={project} reviewState={state} reviewLoading={false}>
      <WorkspaceReviewScopes project={project} panels={editor ? [panel, editor] : [panel]}
        onOpenMessageEditor={(_events, editorRootId) => {
          setEditor({ id: 'editor', type: 'commit-message', rootId: editorRootId });
          return () => setEditor(null);
        }}>
        <Probe name="primary" />
        <WorkspaceReviewScope panel={panel}>{() => <Probe name="changes" />}</WorkspaceReviewScope>
        <div>{!bottom && editorView}</div><div>{bottom && editorView}</div>
      </WorkspaceReviewScopes>
    </WorkspaceGitCommitProvider>;
  }
  render(<I18nProvider initialLocale="zh-CN" messageCatalog={composeRendererMessages(hostMessages, [{ module: reviewRendererFeature }])}>
    <ToastProvider><ReviewFeatureHostBoundary><Workspace /></ReviewFeatureHostBoundary></ToastProvider>
  </I18nProvider>);
  expect(getState).not.toHaveBeenCalled();
  act(() => select('child'));
  await waitFor(() => expect(snapshots.changes.composer?.canAmend).toBe(true));
  act(() => snapshots.changes.composer!.amend());
  await waitFor(() => {
    expect(snapshots.changes.composer?.error).toBeNull();
    expect(snapshots.editor?.messageEditor).toBeTruthy();
  });
  expect(getCommitMessage).toHaveBeenCalledExactlyOnceWith('/agent');
  act(() => snapshots.editor.messageEditor!.setMessage('Child amendment'));
  act(() => { select('main'); moveEditor(); });
  expect(snapshots.primary.messageEditor).toBeNull();
  expect(snapshots.changes.messageEditor).toBeNull();
  expect(snapshots.editor.messageEditor?.message).toBe('Child amendment');
  act(() => snapshots.editor.messageEditor!.save());
  await waitFor(() => expect(commit).toHaveBeenCalledExactlyOnceWith('/agent', {
    message: 'Child amendment', includeUnstaged: false, push: false, amend: { oid: 'a'.repeat(40), branch: 'main' },
  }));
});
