import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesktopReviewPanel, reviewWorkspaceFilePath } from './ReviewPanel.js';
import type { DesktopDiffSummary, DesktopReviewState } from './model.js';

describe('DesktopReviewPanel', () => {
  it('renders collapsible file diffs with prefixes and syntax highlighting', () => {
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
    expect(html).toContain('desktop-review-file-card__chevron');
    expect(html).toContain('desktop-review-file-card__path-main');
    expect(html).not.toContain('desktop-review-file-card__path-button');
    expect(html).toContain('aria-label="Open file in panel"');
    expect(html).toContain('desktop-review-diff-line--removed');
    expect(html).toContain('desktop-review-diff-line--added');
    expect(html).toContain('desktop-review-diff-line__prefix">-</span>');
    expect(html).toContain('desktop-review-diff-line__prefix">+</span>');
    expect(html).toContain('hljs-keyword');
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
      expect(html).toContain('origin/main');
    });
  });

  it('restores the split diff layout for the active project', () => {
    withWindowLocalStorage({ 'setsuna-desktop:review-diff-layout:project_1': 'split' }, () => {
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
      expect(html).toContain('desktop-review-diff desktop-review-diff--split');
      expect(html).not.toContain('desktop-review-diff--wrap');
      expect(html).toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--old');
      expect(html).toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--new');
      expect(html).toContain('desktop-review-diff-split-cell--old desktop-review-diff-split-cell--removed');
      expect(html).toContain('desktop-review-diff-split-cell--new desktop-review-diff-split-cell--added');
    });
  });

  it('restores wrapped review lines for the active project', () => {
    withWindowLocalStorage({
      'setsuna-desktop:review-diff-layout:project_1': 'split',
      'setsuna-desktop:review-line-wrap:project_1': 'wrap',
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

      expect(html).toContain('desktop-review-panel__wrap-toggle is-active');
      expect(html).toContain('data-tooltip="当前：自动换行已开启，点击关闭"');
      expect(html).not.toContain('title="当前：自动换行已开启，点击关闭"');
      expect(html).toContain('desktop-review-diff desktop-review-diff--split desktop-review-diff--wrap');
      expect(html).not.toContain('desktop-review-diff-split-pane desktop-review-diff-split-pane--old');
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
  baseRef: 'origin/main',
  baseRefs: ['origin/main', 'main'],
  branchSummary: null,
  stagedSummary,
  unstagedSummary: latestSummary,
};

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
