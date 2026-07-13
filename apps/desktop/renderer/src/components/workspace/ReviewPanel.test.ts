import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesktopReviewPanel, branchCompareDisplayName, branchCompareRefOptions, highlightedReviewDiffLines, reviewFilePathParts, reviewVirtualRange, reviewWholeFileChangeType, reviewWorkspaceFilePath, shouldRestoreBranchBaseRefPreference, shouldWrapReviewDiffLine } from './ReviewPanel.js';
import type { DesktopDiffSummary, DesktopReviewState } from './model.js';

describe('DesktopReviewPanel', () => {
  it('renders compact file diffs with inline counts, gap bars, and syntax highlighting', () => {
    const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
      activeProject: project,
      error: null,
      latestSummary,
      loading: false,
      reviewState: null,
      onExternalOpenFile: () => undefined,
      onOpenProjectFile: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).toContain('<article class="desktop-review-file-card is-open"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('desktop-review-file-card__chevron');
    expect(html).toContain('desktop-review-file-card__path-main');
    expect(html).toContain('desktop-review-file-card__path-directory">src/domain/agent/drawer/</span>');
    expect(html).toContain('desktop-review-file-card__path-filename">ChatLogDrawer.vue</span>');
    expect(html).not.toContain('desktop-review-file-card__path-button');
    expect(html).toContain('aria-label="Open file in panel"');
    expect(html).toContain('desktop-review-change-counts__addition">+1</span>');
    expect(html).toContain('desktop-review-change-counts__deletion">-1</span>');
    expect(html).toContain('aria-label="折叠所有文件改动"');
    expect(html).toContain('desktop-review-panel__file-expansion-toggle');
    expect(html).not.toContain('desktop-review-file-card__height-toggle');
    expect(html).toContain('desktop-review-diff-line--removed');
    expect(html).toContain('desktop-review-diff-line--added');
    expect(html).not.toContain('desktop-review-diff-line__prefix');
    expect(html).toContain('desktop-review-diff-line--gap');
    expect(html).toContain('desktop-review-diff-gap-content');
    expect(html).toContain('desktop-review-diff-line__number desktop-review-diff-gap-content__gutter');
    expect(html).toContain('desktop-review-diff-gap-content__label">6 unmodified lines</span>');
    expect(html).toContain('6 unmodified lines');
    expect(html).toContain('token keyword');
  });

  it('renders every diff line returned by the review state', () => {
    const fullDiffSummary: DesktopDiffSummary = {
      additions: 40,
      deletions: 0,
      files: [
        {
          path: 'large-change.txt',
          action: 'Modified',
          additions: 40,
          deletions: 0,
          truncated: false,
          lines: Array.from({ length: 40 }, (_, index) => ({
            type: 'added' as const,
            lineNumber: index + 1,
            newLine: index + 1,
            content: `line ${index + 1} full diff`,
          })),
        },
      ],
    };

    const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
      activeProject: project,
      error: null,
      latestSummary: fullDiffSummary,
      loading: false,
      reviewState: null,
      onExternalOpenFile: () => undefined,
      onOpenProjectFile: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).toContain('line 40 full diff');
  });

  it('calculates an overscanned virtual diff range', () => {
    const offsets = Array.from({ length: 101 }, (_, index) => index * 18);

    expect(reviewVirtualRange(offsets, 180, 54, 2)).toEqual({ start: 7, end: 15 });
  });

  it('restores the selected review source for the active project', () => {
    withWindowLocalStorage({ 'setsuna-desktop:review-source:project_1': 'staged' }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary,
        loading: false,
        reviewState,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('已暂存');
      expect(html).toContain('+3');
      expect(html).toContain('-1');
    });
  });

  it('renders the branch compare selector for branch review', () => {
    withWindowLocalStorage({ 'setsuna-desktop:review-source:project_1': 'branch' }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary,
        loading: false,
        reviewState,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-branch-compare');
      expect(html).toContain('main');
      expect(html).toContain('title="origin/main"');
    });
  });

  it('uses raw remote refs for visible branch compare labels', () => {
    expect(branchCompareDisplayName('origin/master')).toBe('origin/master');
    expect(branchCompareDisplayName('master')).toBe('master');
    expect(branchCompareDisplayName('origin/setsuna/temp')).toBe('origin/setsuna/temp');
  });

  it('deduplicates local and remote branch compare refs with remote refs preferred', () => {
    expect(branchCompareRefOptions([
      'origin/master',
      'master',
      'origin',
      'origin/setsuna/temp',
      'setsuna/temp',
      'temp',
    ])).toEqual([
      { value: 'origin/master', label: 'origin/master' },
      { value: 'origin/setsuna/temp', label: 'origin/setsuna/temp' },
      { value: 'temp', label: 'temp' },
    ]);
  });

  it('does not restore a stale branch compare preference after the user picks a new base ref', () => {
    expect(shouldRestoreBranchBaseRefPreference({
      availableBaseRefs: ['master', 'setsuna/temp', 'temp'],
      currentBaseRef: 'setsuna/temp',
      pendingBaseRef: 'setsuna/temp',
      storedBaseRef: 'master',
    })).toBe(false);
  });

  it('restores a branch compare preference before any in-memory selection exists', () => {
    expect(shouldRestoreBranchBaseRefPreference({
      availableBaseRefs: ['master', 'setsuna/temp', 'temp'],
      currentBaseRef: 'setsuna/temp',
      storedBaseRef: 'master',
    })).toBe(true);
  });

  it('restores the split diff layout for the active project', () => {
    withWindowLocalStorage({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'nowrap',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('data-tooltip="当前：左右对比，点击切换为单列对比"');
      expect(html).not.toContain('title="当前：左右对比，点击切换为单列对比"');
      expect(html).not.toContain('desktop-review-panel__layout-toggle is-active');
      expect(html).toContain('lucide-align-justify');
      expect(html).toContain('desktop-review-diff desktop-review-diff--split');
      expect(html).not.toContain('desktop-review-diff--wrap');
      expect(html).toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--old');
      expect(html).toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--new');
      expect(html).toContain('desktop-review-diff-split-cell--old desktop-review-diff-split-cell--removed');
      expect(html).toContain('desktop-review-diff-split-cell--new desktop-review-diff-split-cell--added');
      expect(html).toContain('desktop-review-diff-gap-content__label">6 unmodified lines</span>');
      expect(html).toContain('desktop-review-diff-split-cell--empty');
    });
  });

  it('fills the split diff width for files that only contain additions or removals', () => {
    withWindowLocalStorage({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'nowrap',
    }, () => {
      for (const type of ['added', 'removed'] as const) {
        const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
          activeProject: project,
          error: null,
          latestSummary: wholeFileReviewSummary(type),
          loading: false,
          reviewState: null,
          onExternalOpenFile: () => undefined,
          onOpenProjectFile: () => undefined,
          onRefresh: () => undefined,
        }));

        expect(html).toContain(`desktop-review-diff--single-sided desktop-review-diff--single-sided-${type}`);
        expect(html).toContain(`desktop-review-diff-line desktop-review-diff-line--${type}`);
        expect(html).not.toContain('desktop-review-diff-split-pane');
        expect(html).not.toContain('desktop-review-diff-split-cell--empty');
      }
    });
  });

  it('wraps review lines by default when the project has no saved preference', () => {
    withWindowLocalStorage({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-panel__wrap-toggle');
      expect(html).not.toContain('desktop-review-panel__wrap-toggle is-active');
      expect(html).toContain('lucide-wrap-text');
      expect(html).toContain('data-tooltip="当前：自动换行已开启，点击关闭"');
      expect(html).not.toContain('title="当前：自动换行已开启，点击关闭"');
      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap');
      expect(html).not.toContain('desktop-review-diff--virtual');
      expect(html).toContain('desktop-review-diff-split-row desktop-review-diff-split-row--gap');
      expect(html).toContain('desktop-review-diff-code desktop-review-diff-code--wrap');
      expect(html).not.toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--old');
    });
  });

  it('keeps long split review lines wrapped in row cells instead of split panes', () => {
    const longLineSummary: DesktopDiffSummary = {
      additions: 1,
      deletions: 1,
      files: [
        {
          path: 'apps/desktop/renderer/src/components/workspace/ReviewPanel.test.ts',
          action: 'Modified',
          additions: 1,
          deletions: 1,
          truncated: false,
          lines: [
            {
              type: 'removed',
              lineNumber: 5,
              oldLine: 5,
              content: "import { DesktopReviewPanel, branchCompareDisplayName, branchCompareRefOptions, reviewVirtualRange, reviewWorkspaceFilePath } from './ReviewPanel.js';",
            },
            {
              type: 'added',
              lineNumber: 5,
              newLine: 5,
              content: "import { DesktopReviewPanel, branchCompareDisplayName, branchCompareRefOptions, reviewVirtualRange, reviewWorkspaceFilePath, shouldRestoreBranchBaseRefPreference } from './ReviewPanel.js';",
            },
            { type: 'gap', lineNumber: 6, content: '31 unmodified lines' },
          ],
        },
      ],
    };

    withWindowLocalStorage({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'wrap',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary: longLineSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap');
      expect(html).toContain('desktop-review-diff-split-row');
      expect(html).toContain('desktop-review-diff-split-cell--old desktop-review-diff-split-cell--removed desktop-review-diff-split-cell--wrap');
      expect(html).toContain('desktop-review-diff-split-cell--new desktop-review-diff-split-cell--added desktop-review-diff-split-cell--wrap');
      expect(html).toContain('desktop-review-diff-code desktop-review-diff-code--wrap language-typescript');
      expect(html).not.toContain('desktop-review-diff--virtual');
      expect(html).not.toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--old');
    });
  });

  it('keeps long unified review lines in wrapped normal flow', () => {
    const longLineSummary: DesktopDiffSummary = {
      additions: 1,
      deletions: 1,
      files: [
        {
          path: 'apps/desktop/renderer/src/components/workspace/ReviewPanel.test.ts',
          action: 'Modified',
          additions: 1,
          deletions: 1,
          truncated: false,
          lines: [
            {
              type: 'removed',
              lineNumber: 5,
              oldLine: 5,
              content: "import { DesktopReviewPanel, branchCompareDisplayName, branchCompareRefOptions, reviewVirtualRange, reviewWorkspaceFilePath } from './ReviewPanel.js';",
            },
            {
              type: 'added',
              lineNumber: 5,
              newLine: 5,
              content: "import { DesktopReviewPanel, branchCompareDisplayName, branchCompareRefOptions, reviewVirtualRange, reviewWorkspaceFilePath, shouldRestoreBranchBaseRefPreference } from './ReviewPanel.js';",
            },
          ],
        },
      ],
    };

    withWindowLocalStorage({
      'setsuna-desktop:review-line-wrap:project_1': 'wrap',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary: longLineSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-diff desktop-review-diff--unified desktop-review-diff--wrap');
      expect(html).toContain('desktop-review-diff-line desktop-review-diff-line--removed desktop-review-diff-line--wrap');
      expect(html).toContain('desktop-review-diff-line desktop-review-diff-line--added desktop-review-diff-line--wrap');
      expect(html).toContain('desktop-review-diff-code desktop-review-diff-code--wrap language-typescript');
      expect(html).not.toContain('desktop-review-diff--virtual');
      expect(html).not.toContain('desktop-review-diff-split-pane');
    });
  });

  it('keeps pathological single lines compact even when wrapping is enabled', () => {
    expect(shouldWrapReviewDiffLine('x'.repeat(240), true)).toBe(true);
    expect(shouldWrapReviewDiffLine('x'.repeat(241), true)).toBe(false);
    expect(shouldWrapReviewDiffLine('short line', false)).toBe(false);

    const singleLongLineSummary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [{
        path: 'generated-output.ts',
        action: 'Modified',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{
          type: 'added',
          lineNumber: 1,
          newLine: 1,
          content: `const generated = '${'x'.repeat(600)}';`,
        }],
      }],
    };

    const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
      activeProject: project,
      error: null,
      latestSummary: singleLongLineSummary,
      loading: false,
      reviewState: null,
      onExternalOpenFile: () => undefined,
      onOpenProjectFile: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).toContain('desktop-review-diff-code desktop-review-diff-code--long-line language-typescript');
    expect(html).not.toContain('desktop-review-diff-code desktop-review-diff-code--wrap language-typescript');
  });

  it('virtualizes large wrapped unified diffs in a stable compact viewport', () => {
    const largeWrappedSummary = largeWrappedReviewSummary('large-unified.ts', 90);

    withReviewBrowserEnvironment({ 'setsuna-desktop:review-line-wrap:project_1': 'wrap' }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary: largeWrappedSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-diff desktop-review-diff--unified desktop-review-diff--wrap desktop-review-diff--virtual');
      expect(html).toContain('style="height:320px"');
      expect(html).toContain('desktop-review-diff-virtual-spacer');
      expect(html).toContain('desktop-review-diff-code desktop-review-diff-code--wrap language-typescript');
      expect(html).toContain('desktop-review-diff-line__number">1</span>');
      expect(html).not.toContain('desktop-review-diff-line__number">90</span>');
    });
  });

  it('virtualizes large wrapped split diffs as row pairs instead of independent panes', () => {
    const largeWrappedSummary = largeWrappedReviewSummary('large-split.ts', 90, true);

    withReviewBrowserEnvironment({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'wrap',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary: largeWrappedSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap desktop-review-diff--virtual');
      expect(html).toContain('style="height:320px"');
      expect(html).toContain('desktop-review-diff-split-row');
      expect(html).not.toContain('desktop-review-diff-split-virtual-pane');
      expect(html).toContain('desktop-review-diff-line__number">1</span>');
      expect(html).not.toContain('desktop-review-diff-line__number">90</span>');
    });
  });

  it('virtualizes large whole-file additions as one full-width stream in split mode', () => {
    const largeCreatedSummary = largeWrappedReviewSummary('large-created.ts', 90);

    withReviewBrowserEnvironment({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'wrap',
    }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary: largeCreatedSummary,
        loading: false,
        reviewState: null,
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('desktop-review-diff--single-sided desktop-review-diff--single-sided-added desktop-review-diff--virtual');
      expect(html).toContain('desktop-review-diff-line desktop-review-diff-line--added');
      expect(html).not.toContain('desktop-review-diff-split-row');
      expect(html).not.toContain('desktop-review-diff-split-virtual-pane');
    });
  });

  it('shows review refresh progress while loading', () => {
    const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
      activeProject: project,
      error: null,
      latestSummary,
      loading: true,
      reviewState: null,
      onExternalOpenFile: () => undefined,
      onOpenProjectFile: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).toContain('desktop-review-panel__refresh is-refreshing');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-tooltip="正在刷新审查信息"');
    expect(html).not.toContain('title="正在刷新审查信息"');
  });

  it('maps git review paths back to the active project root', () => {
    const context = {
      source: 'unstaged' as const,
      workspaceRoot: '/Users/zy/work/yuri/front-end/agent',
      gitRoot: '/Users/zy/work/yuri',
    };

    expect(reviewWorkspaceFilePath('front-end/agent/vite.config.ts', context)).toBe('vite.config.ts');
    expect(reviewWorkspaceFilePath('front-end/agent/src/main.ts', context)).toBe('src/main.ts');
    expect(reviewWorkspaceFilePath('front-end/package.json', context)).toBeNull();
  });

  it('keeps latest assistant file changes project-relative', () => {
    expect(reviewWorkspaceFilePath('src/domain/agent/App.vue', {
      source: 'latest',
      workspaceRoot: '/Users/zy/work/yuri/front-end/agent',
      gitRoot: '/Users/zy/work/yuri',
    })).toBe('src/domain/agent/App.vue');
  });

  it('splits review paths so the filename can stay visible when the directory is truncated', () => {
    expect(reviewFilePathParts('front-end/agent/src/App.tsx')).toEqual({
      directory: 'front-end/agent/src/',
      filename: 'App.tsx',
    });
    expect(reviewFilePathParts('front-end\\agent\\src\\App.tsx')).toEqual({
      directory: 'front-end/agent/src/',
      filename: 'App.tsx',
    });
    expect(reviewFilePathParts('App.tsx')).toEqual({ directory: '', filename: 'App.tsx' });
  });

  it('highlights each diff side as a continuous Prism source segment', () => {
    const highlighted = highlightedReviewDiffLines([
      { type: 'removed', lineNumber: 1, oldLine: 1, content: "export type Previous = 'old';" },
      { type: 'added', lineNumber: 1, newLine: 1, content: "export type Current = 'new';" },
      { type: 'context', lineNumber: 2, oldLine: 2, newLine: 2, content: 'const value = Current;' },
      { type: 'gap', lineNumber: 3, content: '8 unmodified lines' },
    ], 'typescript');

    expect(highlighted[0]).toContain('token keyword');
    expect(highlighted[0]).toContain('token class-name');
    expect(highlighted[1]).toContain('token operator');
    expect(highlighted[2]).toContain('token keyword');
    expect(highlighted[3]).toBeUndefined();
  });

  it('detects whole-file changes from diff line semantics', () => {
    expect(reviewWholeFileChangeType([
      { type: 'added', lineNumber: 1, newLine: 1, content: 'first' },
      { type: 'gap', lineNumber: 2, content: '2 unmodified lines' },
      { type: 'added', lineNumber: 3, newLine: 4, content: 'last' },
    ])).toBe('added');
    expect(reviewWholeFileChangeType([
      { type: 'removed', lineNumber: 1, oldLine: 1, content: 'first' },
      { type: 'removed', lineNumber: 2, oldLine: 2, content: 'last' },
    ])).toBe('removed');
    expect(reviewWholeFileChangeType([
      { type: 'removed', lineNumber: 1, oldLine: 1, content: 'before' },
      { type: 'added', lineNumber: 2, newLine: 1, content: 'after' },
    ])).toBeNull();
    expect(reviewWholeFileChangeType([{ type: 'gap', lineNumber: 1, content: '2 unmodified lines' }])).toBeNull();
  });
});

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z',
};

const latestSummary: DesktopDiffSummary = {
  additions: 1,
  deletions: 1,
  files: [
    {
      path: 'src/domain/agent/drawer/ChatLogDrawer.vue',
      action: 'Edited',
      additions: 1,
      deletions: 1,
      truncated: false,
      lines: [
        { type: 'removed', lineNumber: 1, oldLine: 66, content: 'const now = new Date()' },
        { type: 'added', lineNumber: 2, newLine: 66, content: 'const today = new Date()' },
        { type: 'gap', lineNumber: 3, content: '6 unmodified lines' },
      ],
    },
  ],
};

const stagedSummary: DesktopDiffSummary = {
  additions: 3,
  deletions: 1,
  files: [],
};

const reviewState: DesktopReviewState = {
  isGitRepository: true,
  workspaceRoot: project.path,
  gitRoot: project.path,
  currentBranch: 'main',
  currentRemoteRef: 'origin/main',
  baseRef: 'origin/main',
  baseRefs: ['origin/main', 'main'],
  branches: [{ name: 'main', current: true, remote: false, uncommittedFiles: 1 }],
  currentRemoteSummary: null,
  branchSummary: null,
  stagedSummary,
  unstagedSummary: latestSummary,
};

function wholeFileReviewSummary(type: 'added' | 'removed'): DesktopDiffSummary {
  const added = type === 'added';
  return {
    additions: added ? 2 : 0,
    deletions: added ? 0 : 2,
    files: [{
      path: added ? 'created.ts' : 'deleted.ts',
      action: added ? 'Created' : 'Deleted',
      additions: added ? 2 : 0,
      deletions: added ? 0 : 2,
      truncated: false,
      lines: added ? [
        { type: 'added', lineNumber: 1, newLine: 1, content: 'const first = true;' },
        { type: 'added', lineNumber: 2, newLine: 2, content: 'export { first };' },
      ] : [
        { type: 'removed', lineNumber: 1, oldLine: 1, content: 'const first = true;' },
        { type: 'removed', lineNumber: 2, oldLine: 2, content: 'export { first };' },
      ],
    }],
  };
}

function largeWrappedReviewSummary(path: string, lineCount: number, paired = false): DesktopDiffSummary {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    type: 'added' as const,
    lineNumber: paired ? index * 2 + 2 : index + 1,
    newLine: index + 1,
    content: `const wrapped line ${index + 1} = '${'veryLongIdentifier'.repeat(8)}';`,
  }));
  return {
    additions: lineCount,
    deletions: paired ? lineCount : 0,
    files: [
      {
        path,
        action: 'Modified',
        additions: lineCount,
        deletions: paired ? lineCount : 0,
        truncated: false,
        lines: paired ? lines.flatMap((line, index) => [{
          type: 'removed' as const,
          lineNumber: index * 2 + 1,
          oldLine: index + 1,
          content: `const previous line ${index + 1} = false;`,
        }, line]) : lines,
      },
    ],
  };
}

function withReviewBrowserEnvironment(items: Record<string, string>, callback: () => void): void {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe(): void {}
      disconnect(): void {}
    },
  });
  try {
    withWindowLocalStorage(items, callback);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (previousResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousResizeObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
}

function withWindowLocalStorage(items: Record<string, string>, callback: () => void): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => items[key] ?? null,
        setItem: (key: string, value: string) => {
          items[key] = value;
        },
      },
    },
  });
  try {
    callback();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
