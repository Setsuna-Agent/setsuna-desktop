// @vitest-environment happy-dom

import {
  VirtualizedFileDiff,
  Virtualizer as PierreVirtualizer,
} from '@pierre/diffs';
import type {
  RuntimeReviewFinding,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { DesktopReviewPanel } from '../../../../src/features/workspace/ReviewPanel.js';
import { WorkspaceGitCommitProvider } from '../../../../src/features/workspace/git/WorkspaceGitCommitDialog.js';
import type { DesktopDiffSummary, DesktopReviewState } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DesktopReviewPanel interactions', () => {
  it('renders review findings as annotations on their diff lines', async () => {
    const openedFiles: Array<{ path?: string | null; line?: number }> = [];
    mockReviewScroller({
      deferFindingLayout: true,
      diffs: [{ path: 'src/review.ts', top: 250 }],
      findings: [{ path: 'src/review.ts', line: 28, top: 550 }],
      linePositions: { 28: { top: 300, height: 20 } },
    });
    const summary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [{
        path: 'src/review.ts',
        action: 'Modified',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', lineNumber: 28, newLine: 28, content: 'const reviewed = true;' }],
      }],
    };
    const focusedFinding: RuntimeReviewFinding = {
      priority: 'P2',
      title: '行内评论标题',
      body: '行内评论正文，参见 [runtime-turn-finalizer.ts:72](packages/desktop-runtime/src/loop/lifecycle/runtime-turn-finalizer.ts:72)。',
      path: 'src/review.ts',
      startLine: 28,
    };

    render(
      <I18nProvider initialLocale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          focusRequest={{
            finding: focusedFinding,
            path: 'src/review.ts',
            line: 28,
            version: 1,
          }}
          findings={[]}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          workspaceApp={{ id: 'vscode', label: 'VS Code', icon: '' }}
          onExternalOpenFile={(path, line) => openedFiles.push({ path, line })}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector(
        '[data-review-finding-path="src/review.ts"]',
      )?.classList.contains('is-focused')).toBe(true);
    });
    expect(document.querySelector(
      '[data-review-file-path="src/review.ts"]',
    )?.classList.contains('is-focused')).toBe(false);
    await waitFor(() => {
      const diff = document.querySelector('diffs-container');
      const annotationSlot = diff?.shadowRoot?.querySelector<HTMLSlotElement>(
        'slot[name="annotation-additions-28"]',
      );
      const annotationText = annotationSlot?.assignedElements()[0]?.textContent;
      expect(annotationText).toContain('行内评论标题');
      expect(annotationText).toContain('行内评论正文');
    });
    await userEvent.click(screen.getByRole('link', { name: /review\.ts:28/u }));
    expect(openedFiles).toEqual([{ path: 'src/review.ts', line: 28 }]);
    await userEvent.click(screen.getByRole('link', { name: /runtime-turn-finalizer\.ts:72/u }));
    expect(openedFiles.at(-1)).toEqual({
      path: 'packages/desktop-runtime/src/loop/lifecycle/runtime-turn-finalizer.ts',
      line: 72,
    });
  });

  it('renders and focuses a review card whose file is not in the diff', async () => {
    const { virtualizerScrollTo } = mockReviewScroller({
      deferFindingLayout: false,
      diffs: [],
      findings: [{
        path: 'package.json',
        line: 8,
        top: 400,
        height: 80,
      }],
      linePositions: {},
    });
    const focusedFinding: RuntimeReviewFinding = {
      priority: 'P3',
      title: '缺少测试脚本',
      body: '该评论引用了当前 diff 之外的文件。',
      path: 'package.json',
      startLine: 8,
    };
    const summary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [{
        path: 'src/review.ts',
        action: 'Modified',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', lineNumber: 28, newLine: 28, content: 'const reviewed = true;' }],
      }],
    };

    render(
      <I18nProvider initialLocale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={[]}
          focusRequest={{
            finding: focusedFinding,
            line: 8,
            path: 'package.json',
            version: 1,
          }}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('[P3] 缺少测试脚本')).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector(
        '[data-review-finding-path="package.json"]',
      )?.classList.contains('is-focused')).toBe(true);
    });
    expect(document.querySelector(
      '.desktop-review-unanchored-finding',
    )?.classList.contains('is-focused')).toBe(false);
    await waitFor(() => {
      expect(virtualizerScrollTo).toHaveBeenCalledWith({
        top: 380,
        behavior: 'auto',
      });
    });
  });

  it('navigates between virtualized findings in different files on every request', async () => {
    const firstFinding: RuntimeReviewFinding = {
      priority: 'P2',
      title: '第一个文件的评论',
      body: 'First body',
      path: 'src/a.ts',
      startLine: 28,
    };
    const secondFinding: RuntimeReviewFinding = {
      priority: 'P3',
      title: '第二个文件的评论',
      body: 'Second body',
      path: 'src/b.ts',
      startLine: 75,
    };
    const summary: DesktopDiffSummary = {
      additions: 2,
      deletions: 0,
      files: [
        diffFile('src/a.ts', 28),
        diffFile('src/b.ts', 75),
      ],
    };
    const { virtualizerScrollTo } = mockReviewScroller({
      deferFindingLayout: true,
      diffs: [
        { path: 'src/a.ts', top: 250 },
        { path: 'src/b.ts', top: 1_200 },
      ],
      findings: [
        { path: 'src/a.ts', line: 28, top: 550 },
        { path: 'src/b.ts', line: 75, top: 1_500 },
      ],
      linePositions: {
        28: { top: 300, height: 20 },
        75: { top: 300, height: 20 },
      },
    });
    const panel = (finding: RuntimeReviewFinding, version: number) => (
      <I18nProvider initialLocale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={[firstFinding, secondFinding]}
          focusRequest={{
            finding,
            line: finding.startLine,
            path: finding.path,
            version,
          }}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
        />
      </I18nProvider>
    );
    const view = render(panel(firstFinding, 1));

    await waitFor(() => {
      expect(virtualizerScrollTo).toHaveBeenCalledWith({
        top: 500,
        behavior: 'auto',
      });
    });
    view.rerender(panel(secondFinding, 2));
    await waitFor(() => {
      expect(virtualizerScrollTo).toHaveBeenCalledWith({
        top: 1_450,
        behavior: 'auto',
      });
    });
    view.rerender(panel(firstFinding, 3));
    await waitFor(() => {
      expect(virtualizerScrollTo.mock.calls.at(-1)?.[0]).toEqual({
        top: 500,
        behavior: 'auto',
      });
    });
  });

  it('opens the shared Git dialog from the review action', async () => {
    render(
      <I18nProvider initialLocale="en-US">
        <ToastProvider>
          <WorkspaceGitCommitProvider
            activeProject={project}
            reviewLoading={false}
            reviewState={reviewState}
          >
            <DesktopReviewPanel
              activeProject={project}
              error={null}
              latestSummary={emptySummary}
              loading={false}
              reviewState={reviewState}
              onExternalOpenFile={() => undefined}
              onOpenProjectFile={() => undefined}
              onRefresh={() => undefined}
            />
          </WorkspaceGitCommitProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Commit or push' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Commit or push' })).toBeTruthy();
  });
});

const project: WorkspaceProject = {
  id: 'project_review_interaction',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z',
};

const emptySummary: DesktopDiffSummary = {
  additions: 0,
  deletions: 0,
  files: [],
};

const reviewState: DesktopReviewState = {
  isGitRepository: true,
  workspaceRoot: project.path!,
  gitRoot: project.path!,
  currentBranch: 'main',
  currentRemoteRef: 'origin/main',
  baseRef: 'origin/main',
  baseRefs: ['origin/main', 'main'],
  branches: [{ name: 'main', current: true, remote: false, uncommittedFiles: 0 }],
  currentRemoteSummary: null,
  branchSummary: null,
  stagedSummary: emptySummary,
  unstagedSummary: emptySummary,
};

function rect({ top, height }: { top: number; height: number }): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 300,
    top,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function diffFile(path: string, line: number): DesktopDiffSummary['files'][number] {
  return {
    path,
    action: 'Modified',
    additions: 1,
    deletions: 0,
    truncated: false,
    lines: [{
      type: 'added',
      lineNumber: line,
      newLine: line,
      content: `const line${line} = true;`,
    }],
  };
}

function mockReviewScroller({
  deferFindingLayout,
  diffs,
  findings,
  linePositions,
}: {
  deferFindingLayout: boolean;
  diffs: Array<{ path: string; top: number }>;
  findings: Array<{
    path: string;
    line: number;
    top: number;
    height?: number;
  }>;
  linePositions: Record<number, { top: number; height: number }>;
}) {
  const scrollRoot = document.createElement('div');
  Object.defineProperties(scrollRoot, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 3_000 },
  });
  scrollRoot.scrollTop = 0;
  vi.spyOn(PierreVirtualizer.prototype, 'getRoot')
    .mockReturnValue(scrollRoot);
  vi.spyOn(PierreVirtualizer.prototype, 'getScrollTop')
    .mockImplementation(() => scrollRoot.scrollTop);
  vi.spyOn(PierreVirtualizer.prototype, 'getOffsetInScrollContainer')
    .mockImplementation((element) => (
      scrollRoot.scrollTop
        + element.getBoundingClientRect().top
        - scrollRoot.getBoundingClientRect().top
    ));
  const virtualizerScrollTo = vi
    .spyOn(PierreVirtualizer.prototype, 'scrollTo')
    .mockImplementation(({ top }) => {
      scrollRoot.scrollTop = top;
    });
  vi.spyOn(VirtualizedFileDiff.prototype, 'getLinePosition')
    .mockImplementation((lineNumber) => linePositions[lineNumber]);
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      if (this === scrollRoot) return rect({ top: 10, height: 100 });
      const finding = findings.find((candidate) => (
        this.matches(
          `[data-review-finding-path="${candidate.path}"]`
            + `[data-review-finding-line="${candidate.line}"]`,
        )
      ));
      if (finding) {
        const visible = !deferFindingLayout
          || Math.abs(finding.top - scrollRoot.scrollTop) <= 200;
        return rect({
          top: visible ? finding.top - scrollRoot.scrollTop : 0,
          height: visible ? finding.height ?? 20 : 0,
        });
      }
      const fileCard = this.matches('[data-review-file-path]')
        ? this.dataset.reviewFilePath
        : null;
      const fileDiff = this.matches('diffs-container')
        ? this.closest<HTMLElement>('[data-review-file-path]')
          ?.dataset.reviewFilePath
        : null;
      const diff = diffs.find((candidate) => (
        candidate.path === (fileDiff ?? fileCard)
      ));
      if (diff) {
        return rect({
          top: diff.top - scrollRoot.scrollTop,
          height: fileDiff ? 700 : 740,
        });
      }
      return originalGetBoundingClientRect.call(this);
    });
  return { virtualizerScrollTo };
}
