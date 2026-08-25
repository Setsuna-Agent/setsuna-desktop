// @vitest-environment happy-dom

import {
  VirtualizedFileDiff,
  Virtualizer as PierreVirtualizer,
} from '@pierre/diffs';
import type {
  RuntimeReviewFinding,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type {
  DesktopDiffSummary,
  DesktopReviewBridge,
  DesktopReviewState,
} from '../../src/contracts/index.js';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopReviewPanel } from '../../src/renderer/ReviewPanel.js';
import { WorkspaceGitCommitProvider } from '../../src/renderer/git/WorkspaceGitCommitDialog.js';
import { ReviewRendererTestHost } from './review-renderer-test-host.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DesktopReviewPanel interactions', () => {
  it('does not rerender an unchanged Pierre diff when its parent rerenders', async () => {
    const summary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [diffFile('src/stable.ts', 1)],
    };
    const state = { ...reviewState, unstagedSummary: summary };
    const findings: RuntimeReviewFinding[] = [];
    const workspaceApps: [] = [];
    const noop = () => undefined;
    const pierreRender = vi.spyOn(VirtualizedFileDiff.prototype, 'render');
    const panel = () => (
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={findings}
          latestSummary={summary}
          loading={false}
          reviewState={state}
          workspaceApps={workspaceApps}
          onExternalOpenFile={noop}
          onOpenProjectFile={noop}
          onRefresh={noop}
          onSelectBaseRef={noop}
        />
      </ReviewRendererTestHost>
    );
    const view = render(panel());

    await waitFor(() => expect(pierreRender).toHaveBeenCalled());
    const renderCount = pierreRender.mock.calls.length;
    view.rerender(panel());

    expect(pierreRender).toHaveBeenCalledTimes(renderCount);
  });

  it('expands unsupported formats with a user-facing format notice', () => {
    const summary: DesktopDiffSummary = {
      additions: 0,
      deletions: 0,
      files: [{
        path: 'docs/spec.docx',
        action: 'Created',
        additions: 0,
        deletions: 0,
        contentKind: 'binary',
        truncated: false,
        lines: [],
      }],
    };

    render(
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={[]}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    expect(screen.getByText('暂不支持预览此文件格式')).toBeTruthy();
    expect(screen.queryByText('二进制文件')).toBeNull();
    expect(document.querySelector('diffs-container')).toBeNull();
  });

  it('shows before and after images when image changes use split view', async () => {
    const releaseImagePreview = vi.fn().mockResolvedValue(true);
    const createImagePreview = vi.fn().mockImplementation((
      _workspaceRoot: string,
      input: { side: 'before' | 'after' },
    ) => Promise.resolve({
      ok: true,
      previewId: `${input.side}-${createImagePreview.mock.calls.length}`,
      url: `setsuna-preview://review/${input.side}.png`,
    }));
    const bridge = {
      createImagePreview,
      releaseImagePreview,
    } as unknown as DesktopReviewBridge;
    const summary: DesktopDiffSummary = {
      additions: 0,
      deletions: 0,
      files: [{
        path: 'src/assets/icon.png',
        previousPath: 'src/assets/old-icon.png',
        action: 'Renamed',
        additions: 0,
        deletions: 0,
        contentKind: 'image',
        truncated: false,
        lines: [],
      }],
    };

    const renderPanel = (activeSummary: DesktopDiffSummary) => (
      <ReviewRendererTestHost bridge={bridge} locale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={[]}
          latestSummary={activeSummary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: activeSummary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>
    );
    const view = render(renderPanel(summary));

    const currentPreview = await screen.findByRole('img', { name: '修改后：src/assets/icon.png' });
    expect(screen.getByRole('button', { name: /折叠 src\/assets\/icon\.png/u }).textContent)
      .toBe('src/assets/icon.png');
    expect(currentPreview.getAttribute('src')).toBe('setsuna-preview://review/after.png');

    await userEvent.click(screen.getByRole('button', {
      name: '当前：单列对比，点击切换为左右对比',
    }));

    const previousPreview = await screen.findByRole('img', { name: '修改前：src/assets/old-icon.png' });
    expect(previousPreview.getAttribute('src')).toBe('setsuna-preview://review/before.png');
    expect(screen.queryByText('修改前')).toBeNull();
    expect(screen.queryByText('修改后')).toBeNull();
    expect(createImagePreview).toHaveBeenCalledWith('/tmp/fixture', {
      baseRef: 'origin/main',
      filePath: 'src/assets/old-icon.png',
      side: 'before',
      source: 'unstaged',
    });
    expect(createImagePreview).toHaveBeenCalledWith('/tmp/fixture', {
      baseRef: 'origin/main',
      filePath: 'src/assets/icon.png',
      side: 'after',
      source: 'unstaged',
    });
    const refreshedSummary: DesktopDiffSummary = {
      ...summary,
      files: summary.files.map((file) => ({ ...file })),
    };
    view.rerender(renderPanel(refreshedSummary));
    await waitFor(() => expect(createImagePreview).toHaveBeenCalledTimes(4));
    expect(releaseImagePreview).toHaveBeenCalledTimes(2);
    expect(document.querySelector('diffs-container')).toBeNull();
  });

  it('renders annotations and opens resolved workspace lines', async () => {
    const openedFiles: Array<{ path?: string | null; line?: number }> = [];
    mockReviewScroller({
      deferFindingLayout: true,
      diffs: [
        { path: 'packages/app/src/review.ts', top: 250 },
        { path: 'packages/app/src/helper.ts', top: 900 },
      ],
      findings: [{ path: 'src/review.ts', line: 28, top: 550 }],
      linePositions: { 28: { top: 300, height: 20 } },
    });
    const summary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [
        {
          path: 'packages/app/src/review.ts',
          action: 'Modified',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', lineNumber: 28, newLine: 28, content: 'const reviewed = true;' }],
        },
        {
          path: 'packages/app/src/helper.ts',
          action: 'Modified',
          additions: 0,
          deletions: 0,
          truncated: false,
          lines: [],
        },
      ],
    };
    const focusedFinding: RuntimeReviewFinding = {
      priority: 'P2',
      title: '行内评论标题',
      body: '行内评论正文，参见 [helper.ts:7](src/helper.ts:7)。',
      path: 'src/review.ts',
      startLine: 28,
    };

    render(
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={nestedProject}
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
          reviewState={{
            ...reviewState,
            workspaceRoot: nestedProject.path!,
            gitRoot: project.path!,
            unstagedSummary: summary,
          }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={(path, line) => openedFiles.push({ path, line })}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    await waitFor(() => {
      expect(document.querySelector(
        '[data-review-finding-path="src/review.ts"]',
      )?.classList.contains('is-focused')).toBe(true);
    });
    expect(document.querySelector(
      '[data-review-file-path="packages/app/src/review.ts"]',
    )?.classList.contains('is-focused')).toBe(false);
    await waitFor(() => {
      const diff = document.querySelector(
        '[data-review-file-path="packages/app/src/review.ts"] diffs-container',
      );
      const annotation = diff?.querySelector<HTMLElement>(
        '[slot="annotation-additions-28"]',
      );
      const annotationText = annotation?.textContent;
      expect(annotationText).toContain('行内评论标题');
      expect(annotationText).toContain('行内评论正文');
    });
    await userEvent.click(screen.getByRole('button', { name: /review\.ts:28/u }));
    expect(openedFiles).toEqual([{ path: 'src/review.ts', line: 28 }]);
    await userEvent.click(screen.getByRole('link', { name: /helper\.ts:7/u }));
    expect(openedFiles.at(-1)).toEqual({
      path: 'src/helper.ts',
      line: 7,
    });
  });

  it('renders an unavailable location for a focused finding outside the project', async () => {
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
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={nestedProject}
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
          reviewState={{
            ...reviewState,
            workspaceRoot: nestedProject.path!,
            gitRoot: project.path!,
            unstagedSummary: summary,
          }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    expect(screen.getByText('[P3] 缺少测试脚本')).toBeTruthy();
    const location = screen.getByText('package.json:8');
    expect(location.tagName).toBe('SPAN');
    expect(location.classList.contains('is-unavailable')).toBe(true);
    expect(screen.queryByRole('button', { name: 'package.json:8' })).toBeNull();
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
      <ReviewRendererTestHost locale="zh-CN">
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
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>
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

  it('yields navigation to user scroll intent instead of fighting it', async () => {
    const finding: RuntimeReviewFinding = {
      priority: 'P2',
      title: '远端评论',
      body: 'Navigation target far below the viewport.',
      path: 'src/a.ts',
      startLine: 28,
    };
    const summary: DesktopDiffSummary = {
      additions: 1,
      deletions: 0,
      files: [diffFile('src/a.ts', 28)],
    };
    const { virtualizerScrollTo } = mockReviewScroller({
      deferFindingLayout: true,
      diffs: [{ path: 'src/a.ts', top: 1_200 }],
      findings: [{ path: 'src/a.ts', line: 28, top: 1_500 }],
      linePositions: { 28: { top: 300, height: 20 } },
    });
    render(
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          findings={[finding]}
          focusRequest={{
            finding,
            line: 28,
            path: 'src/a.ts',
            version: 1,
          }}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    // The user takes over scrolling before the alignment loop converges. The
    // pending navigation session must be dropped, not resumed on later frames.
    const scrollRoot = document.querySelector(
      '.desktop-review-panel__sections',
    );
    expect(scrollRoot).toBeTruthy();
    fireEvent.wheel(scrollRoot as Element, { deltaY: -240 });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(virtualizerScrollTo).not.toHaveBeenCalled();
  });

  it('opens the shared Git dialog from the review action', async () => {
    render(
      <ReviewRendererTestHost locale="en-US">
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
            onSelectBaseRef={() => undefined}
          />
        </WorkspaceGitCommitProvider>
      </ReviewRendererTestHost>,
    );

    const trigger = screen.getByRole('button', { name: 'Commit or push' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Commit or push' })).toBeTruthy();

    const includeUnstaged = screen.getByRole('checkbox', { name: 'Include unstaged changes' }) as HTMLInputElement;
    expect(includeUnstaged.checked).toBe(true);
    await userEvent.click(includeUnstaged);
    expect(includeUnstaged.checked).toBe(false);
  });

  it('refreshes a branch review without changing its selected base ref', async () => {
    const onRefresh = vi.fn();
    window.localStorage.setItem('setsuna-desktop:review-source:project_review_interaction', 'branch');
    render(
      <ReviewRendererTestHost locale="en-US">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          latestSummary={emptySummary}
          loading={false}
          reviewState={{ ...reviewState, branchSummary: emptySummary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={onRefresh}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Refresh review information' }));

    expect(onRefresh).toHaveBeenCalledWith();
  });

  it('keeps a successful review snapshot visible after a background refresh error', () => {
    render(
      <ReviewRendererTestHost locale="en-US">
        <DesktopReviewPanel
          activeProject={project}
          error="refresh failed"
          latestSummary={emptySummary}
          loading={false}
          reviewState={reviewState}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    expect(screen.queryByText('Could not load review information')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh review information' })).toBeTruthy();
  });

  it('switches the only mounted diff and preserves large-review navigation preferences', async () => {
    const pierreRender = vi.spyOn(VirtualizedFileDiff.prototype, 'render');
    const summary: DesktopDiffSummary = {
      additions: 25,
      deletions: 0,
      files: Array.from({ length: 25 }, (_, index) => (
        diffFile(`src/file-${index}.ts`, index + 1)
      )),
    };

    render(
      <ReviewRendererTestHost locale="zh-CN">
        <DesktopReviewPanel
          activeProject={project}
          error={null}
          latestSummary={summary}
          loading={false}
          reviewState={{ ...reviewState, unstagedSummary: summary }}
          onExternalOpenFile={() => undefined}
          onOpenProjectFile={() => undefined}
          onRefresh={() => undefined}
          onSelectBaseRef={() => undefined}
        />
      </ReviewRendererTestHost>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('diffs-container')).toHaveLength(1);
      expect(screen.getByRole('button', { name: /折叠 src\/file-0\.ts/u })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'src/file-1.ts' }));
    await waitFor(() => {
      expect(document.querySelectorAll('diffs-container')).toHaveLength(1);
      expect(screen.getByRole('button', { name: /折叠 src\/file-1\.ts/u })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /折叠 src\/file-0\.ts/u })).toBeNull();
    });
    const selectedDiffRenderCount = pierreRender.mock.calls.length;

    expect(screen.getByRole('button', { name: 'src' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换为平铺列表' }));
    expect(screen.queryByRole('button', { name: 'src' })).toBeNull();
    expect(screen.getByRole('button', { name: '切换为目录树' })).toBeTruthy();
    expect(window.localStorage.getItem('setsuna-desktop:review-file-browser-layout')).toBe('flat');

    const resizeHandle = screen.getByRole('separator', { name: '调整变更文件栏宽度' });
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('248');
    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 460, pointerId: 1 });
    expect(screen.getByRole('separator', { name: '调整变更文件栏宽度' })
      .getAttribute('aria-valuenow')).toBe('288');
    expect(window.localStorage.getItem('setsuna-desktop:review-file-browser-width')).toBe('288');

    fireEvent.click(screen.getByRole('button', { name: '收起变更文件' }));
    expect(document.querySelector('.desktop-review-file-tree')?.classList
      .contains('is-collapsed')).toBe(true);
    expect(screen.queryByRole('separator', { name: '调整变更文件栏宽度' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开变更文件' })).toBeTruthy();
    expect(window.localStorage.getItem('setsuna-desktop:review-file-browser-visible')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '展开变更文件' }));
    expect(screen.getByRole('separator', { name: '调整变更文件栏宽度' })
      .getAttribute('aria-valuenow')).toBe('288');
    expect(pierreRender).toHaveBeenCalledTimes(selectedDiffRenderCount);
  });
});

const project: WorkspaceProject = {
  id: 'project_review_interaction',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z',
};

const nestedProject: WorkspaceProject = {
  ...project,
  id: 'project_review_interaction_nested',
  path: '/tmp/fixture/packages/app',
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
