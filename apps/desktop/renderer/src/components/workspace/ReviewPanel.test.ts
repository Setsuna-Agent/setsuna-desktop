import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { DesktopReviewPanel } from './ReviewPanel.js';
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

    expect(html).toContain('<details class="desktop-review-file-card" open');
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
