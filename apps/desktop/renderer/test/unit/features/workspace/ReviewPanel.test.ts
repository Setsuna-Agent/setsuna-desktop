import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DesktopReviewPanel,
  branchCompareDisplayName,
  branchCompareRefOptions,
  consumeReviewFocusRequest,
  reviewFilePathParts,
  reviewWorkspaceFilePath,
  shouldRestoreBranchBaseRefPreference,
} from '../../../../src/features/workspace/ReviewPanel.js';
import type { DesktopDiffSummary, DesktopReviewState } from '../../../../src/features/workspace/model.js';

describe('DesktopReviewPanel', () => {
  it('renders compact file diffs through a valid Pierre patch', () => {
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

    expect(html).toContain('diff --git a/src/domain/agent/drawer/ChatLogDrawer.vue b/src/domain/agent/drawer/ChatLogDrawer.vue');
    expect(html).toContain('-const now = new Date()');
    expect(html).toContain('+const today = new Date()');
  });

  it('sorts changed files by path without putting uppercase names first', () => {
    const templateFile = latestSummary.files[0];
    if (!templateFile) throw new Error('Expected a review file fixture');
    const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
      activeProject: project,
      error: null,
      latestSummary: {
        additions: 3,
        deletions: 3,
        files: [
          { ...templateFile, path: 'Tree.md' },
          { ...templateFile, path: 'apps/file10.ts' },
          { ...templateFile, path: 'apps/File2.ts' },
        ],
      },
      loading: false,
      reviewState: null,
      onExternalOpenFile: () => undefined,
      onOpenProjectFile: () => undefined,
      onRefresh: () => undefined,
    }));

    const file2Index = html.indexOf('apps/File2.ts');
    const file10Index = html.indexOf('apps/file10.ts');
    const treeIndex = html.indexOf('Tree.md');
    expect(file2Index).toBeGreaterThan(-1);
    expect(file10Index).toBeGreaterThan(file2Index);
    expect(treeIndex).toBeGreaterThan(file10Index);
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
      expect(html).toContain('desktop-review-change-counts__addition">+3</span>');
      expect(html).toContain('desktop-review-change-counts__deletion">-1</span>');
    });
  });

  it('shows the selected source diff totals beside every source label', () => {
    const summaries = {
      unstaged: { additions: 11, deletions: 12, files: [] },
      staged: { additions: 21, deletions: 22, files: [] },
      branch: { additions: 31, deletions: 32, files: [] },
      latest: { additions: 41, deletions: 42, files: [] },
    } satisfies Record<'unstaged' | 'staged' | 'branch' | 'latest', DesktopDiffSummary>;
    const labels = {
      unstaged: '未暂存',
      staged: '已暂存',
      branch: '分支',
      latest: '上轮对话',
    } as const;

    for (const source of ['unstaged', 'staged', 'branch', 'latest'] as const) {
      withWindowLocalStorage({ 'setsuna-desktop:review-source:project_1': source }, () => {
        const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
          activeProject: project,
          error: null,
          latestSummary: summaries.latest,
          loading: false,
          reviewState: {
            ...reviewState,
            branchSummary: summaries.branch,
            stagedSummary: summaries.staged,
            unstagedSummary: summaries.unstaged,
          },
          onExternalOpenFile: () => undefined,
          onOpenProjectFile: () => undefined,
          onRefresh: () => undefined,
        }));

        expect(html).toContain(labels[source]);
        expect(html).toContain(`desktop-review-change-counts__addition">+${summaries[source].additions}</span>`);
        expect(html).toContain(`desktop-review-change-counts__deletion">-${summaries[source].deletions}</span>`);
      });
    }
  });

  it('consumes automatic file focus once so manual source selection is not reverted', () => {
    const firstFocus = consumeReviewFocusRequest(null, 'project_1:Tile.tsx:1', 'unstaged');
    expect(firstFocus).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:1',
      shouldApply: true,
    });

    expect(consumeReviewFocusRequest(
      firstFocus.nextHandledRequestKey,
      'project_1:Tile.tsx:1',
      'unstaged',
    )).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:1',
      shouldApply: false,
    });

    expect(consumeReviewFocusRequest(
      firstFocus.nextHandledRequestKey,
      'project_1:Tile.tsx:2',
      'staged',
    )).toEqual({
      nextHandledRequestKey: 'project_1:Tile.tsx:2',
      shouldApply: true,
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
      expect(html).toContain('desktop-review-panel__toolbar--branch');
      expect(html).toContain('main');
      expect(html).toContain('title="origin/main"');
    });
  });

  it('falls back to unstaged changes when an unborn repository has no branch comparison base', () => {
    withWindowLocalStorage({ 'setsuna-desktop:review-source:project_1': 'branch' }, () => {
      const html = renderToStaticMarkup(createElement(DesktopReviewPanel, {
        activeProject: project,
        error: null,
        latestSummary,
        loading: false,
        reviewState: {
          ...reviewState,
          baseRef: null,
          baseRefs: [],
          branchSummary: null,
          currentRemoteRef: null,
          currentRemoteSummary: null,
        },
        onExternalOpenFile: () => undefined,
        onOpenProjectFile: () => undefined,
        onRefresh: () => undefined,
      }));

      expect(html).toContain('未暂存');
      expect(html).not.toContain('desktop-review-branch-compare');
      expect(html).not.toContain('desktop-review-panel__toolbar--branch');
      expect(html).not.toContain('未设置');
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
      expect(html).not.toContain('desktop-review-diff-split-pane');
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

        expect(html).toContain('desktop-review-diff desktop-review-diff--split');
        expect(html).not.toContain('desktop-review-diff-split-pane');
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
      expect(html).not.toContain('setsuna-pierre-virtualizer');
      expect(html).not.toContain('desktop-review-diff-split-row');
    });
  });

  it('keeps long split review lines wrapped in row cells instead of split panes', () => {
    const longLineSummary: DesktopDiffSummary = {
      additions: 1,
      deletions: 1,
      files: [
        {
          path: 'apps/desktop/renderer/test/unit/features/workspace/ReviewPanel.test.ts',
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
      expect(html).not.toContain('desktop-review-diff-split-row');
      expect(html).not.toContain('setsuna-pierre-virtualizer');
    });
  });

  it('keeps long unified review lines in wrapped normal flow', () => {
    const longLineSummary: DesktopDiffSummary = {
      additions: 1,
      deletions: 1,
      files: [
        {
          path: 'apps/desktop/renderer/test/unit/features/workspace/ReviewPanel.test.ts',
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
      expect(html).toContain('setsuna-pierre-surface');
      expect(html).not.toContain('desktop-review-diff-line');
      expect(html).not.toContain('desktop-review-diff-split-pane');
    });
  });

  it('delegates pathological single-line wrapping to Pierre', () => {
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

    expect(html).toContain('desktop-review-diff desktop-review-diff--unified desktop-review-diff--wrap');
    expect(html).toContain('const generated');
    expect(html).not.toContain('desktop-review-diff-code--long-line');
  });

  it('virtualizes large wrapped unified diffs in the shared review scroller', () => {
    const largeWrappedSummary = largeWrappedReviewSummary('large-unified.ts', 450);

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

      expectSharedReviewVirtualizer(html);
      expect(html).toContain('desktop-review-diff desktop-review-diff--unified desktop-review-diff--wrap');
      expect(html).not.toContain('desktop-review-diff-virtual-spacer');
    });
  });

  it('virtualizes large wrapped split diffs without independent scroll panes', () => {
    const largeWrappedSummary = largeWrappedReviewSummary('large-split.ts', 250, true);

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

      expectSharedReviewVirtualizer(html);
      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap');
      expect(html).not.toContain('desktop-review-diff-split-row');
      expect(html).not.toContain('desktop-review-diff-split-virtual-pane');
    });
  });

  it('virtualizes large whole-file additions in the shared review scroller', () => {
    const largeCreatedSummary = largeWrappedReviewSummary('large-created.ts', 450);

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

      expectSharedReviewVirtualizer(html);
      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap');
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

function expectSharedReviewVirtualizer(html: string): void {
  expect(html.match(/class="desktop-review-panel__sections"/gu)).toHaveLength(1);
  expect(html).toContain('desktop-review-panel__sections-content');
  expect(html).not.toContain('setsuna-pierre-virtualizer');
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
