import type { RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { AppTooltip } from '../../../../../src/shared/ui/primitives.js';
import type {
  ConversationOverviewState,
} from '../../../../../src/features/chat/conversation/chatConversationOverview.js';
import { ConversationOverviewPanel } from '../../../../../src/features/chat/conversation/ConversationOverviewPanel.js';
import type { DesktopDiffSummary, DesktopReviewState } from '../../../../../src/features/workspace/model.js';

describe('ConversationOverviewPanel', () => {
  it('uses the same local git summary and keeps the review action argument-free', () => {
    const localReviewState: DesktopReviewState = {
      ...reviewState,
      stagedSummary: {
        additions: 3,
        deletions: 5,
        files: [{ ...gitSummary.files[0], path: 'README.md', additions: 3, deletions: 5 }],
      },
    };
    const compactHtml = renderOverviewPanel({
      ...baseProps,
      compact: true,
      reviewState: localReviewState,
    });
    const expandedHtml = renderOverviewPanel({
      ...baseProps,
      compact: false,
      reviewState: localReviewState,
    });

    expect(compactHtml).toContain('变更');
    expect(compactHtml).toContain('aria-label="展开对话环境信息"');
    expect(compactHtml).toContain('+74');
    expect(compactHtml).toContain('-252');
    expect(compactHtml).not.toContain('2 个文件');
    expect(expandedHtml).toContain('变更');
    expect(expandedHtml).toContain('+74');
    expect(expandedHtml).toContain('-252');
    expect(expandedHtml).not.toContain('2 个文件');
    expect(expandedHtml).not.toContain('无变更');
    expect(expandedHtml).not.toContain('打开文件');

    const onOpenReview = vi.fn();
    const panel = captureOverviewPanel({ ...baseProps, compact: false, onOpenReview });
    const reviewButton = panel.props.children[1].props.children[0];
    reviewButton.props.onClick({ type: 'click' });
    expect(onOpenReview).toHaveBeenCalledWith();
  });

  it('shows untracked worktree changes before a repository has its first commit', () => {
    const unbornReviewState: DesktopReviewState = {
      ...reviewState,
      baseRef: null,
      baseRefs: [],
      branchSummary: null,
      currentRemoteRef: null,
      currentRemoteSummary: null,
      stagedSummary: { additions: 0, deletions: 0, files: [] },
      unstagedSummary: gitSummary,
    };
    const html = renderOverviewPanel({
      ...baseProps,
      compact: false,
      reviewState: unbornReviewState,
    });

    expect(html).toContain('+71');
    expect(html).toContain('-247');
    expect(html).not.toContain('1 个文件');
    expect(html).not.toContain('无变更');
  });

  it('does not report a clean worktree or HEAD while git status is still loading', () => {
    const html = renderOverviewPanel({
      ...baseProps,
      compact: false,
      reviewLoading: true,
      reviewState: null,
    });

    expect(html.match(/加载中/g)).toHaveLength(2);
    expect(html).not.toContain('无变更');
    expect(html).not.toContain('>HEAD<');
  });

  it('shows the review failure instead of reporting no changes', () => {
    const html = renderOverviewPanel({
      ...baseProps,
      compact: false,
      reviewError: 'git status failed',
      reviewState: null,
    });

    expect(html.match(/加载失败/g)).toHaveLength(2);
    expect(html).toContain('title="git status failed"');
    expect(html).not.toContain('无变更');
  });

  it('shows collaboration tasks from the parent thread ledger', () => {
    const html = renderOverviewPanel({
      ...baseProps,
      compact: false,
      currentThread: {
        ...baseProps.currentThread,
        collaborationTasks: [{
          id: 'task_1',
          childThreadId: 'child_1',
          title: 'Child agent',
          objective: 'Inspect the repository.',
          identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
          status: 'running',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        }],
      },
    });

    expect(html).toContain('aria-label="1 个协作任务"');
    expect(html).toContain('Scout');
    expect(html).toContain('运行中');
  });

  it('renders active plan progress with its detail popover', () => {
    const html = renderOverviewPanel({
      ...baseProps,
      compact: false,
      overview: {
        ...overview,
        planItems: [
          { step: 'Inspect implementation', status: 'completed' },
          { step: 'Apply focused change', status: 'in_progress' },
        ],
      },
    });

    expect(html).toContain('aria-label="计划推进中，已完成 1/2"');
    expect(html).toContain('chat-conversation-overview-panel__plan-popover');
    expect(html).toContain('Apply focused change');
  });

  it('shows total usage, an integer cache hit rate, and call count', () => {
    const props = {
      ...baseProps,
      compact: false,
      threadUsage: {
        records: [],
        summary: {
          inputTokens: 800_000,
          cachedInputTokens: 756_000,
          outputTokens: 50_000,
          totalTokens: 850_000,
          recordCount: 1,
          byDay: [],
          byProvider: [],
          byModel: [],
        },
      },
    };
    const html = renderOverviewPanel(props);

    expect(html).toContain('850.0K · 95% · 1 次');
    expect(html).not.toContain('已完成');
    expect(html).not.toContain('title="850.0K · 95% · 1 次"');

    const panel = captureOverviewPanel(props);
    const usageRow = panel.props.children[1].props.children[3];
    const usageTooltip = usageRow.props.children[2];
    expect(usageTooltip.type).toBe(AppTooltip);
    expect(usageTooltip.props.children.props.title).toBeUndefined();

    const tooltipHtml = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: 'zh-CN' },
      usageTooltip.props.title,
    ));
    expect(tooltipHtml).toContain('总 Token');
    expect(tooltipHtml).toContain('缓存命中率');
    expect(tooltipHtml).toContain('调用次数');
    expect(tooltipHtml).toContain('850.0K');
    expect(tooltipHtml).toContain('95%');
    expect(tooltipHtml).toContain('1 次');
  });

});

function renderOverviewPanel(
  props: Parameters<typeof ConversationOverviewPanel>[0],
): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN' },
    createElement(ToastProvider, null, createElement(ConversationOverviewPanel, props)),
  ));
}

function captureOverviewPanel(props: Parameters<typeof ConversationOverviewPanel>[0]) {
  const captured: { panel?: ReturnType<typeof ConversationOverviewPanel> } = {};
  function Capture() {
    captured.panel = ConversationOverviewPanel(props);
    return captured.panel;
  }
  renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN' },
    createElement(ToastProvider, null, createElement(Capture)),
  ));
  if (!captured.panel) throw new Error('Conversation overview panel did not render.');
  return captured.panel;
}

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const gitSummary: DesktopDiffSummary = {
  additions: 71,
  deletions: 247,
  files: [
    {
      path: 'Book/2048/style/main.css',
      action: 'Edited',
      additions: 71,
      deletions: 247,
      truncated: false,
      lines: [],
    },
  ],
};

const overview: ConversationOverviewState = {
  fileChangeSummary: {
    additions: 1,
    deletions: 1,
    files: [],
  },
  planItems: [],
};

const reviewState: DesktopReviewState = {
  isGitRepository: true,
  workspaceRoot: project.path!,
  gitRoot: project.path!,
  currentBranch: 'setsuna/temp',
  currentRemoteRef: 'origin/setsuna/temp',
  baseRef: 'origin/setsuna/temp',
  baseRefs: ['setsuna/temp', 'origin/setsuna/temp'],
  branches: [{ name: 'setsuna/temp', current: true, remote: false, uncommittedFiles: 1 }],
  currentRemoteSummary: gitSummary,
  branchSummary: null,
  stagedSummary: null,
  unstagedSummary: gitSummary,
};

const baseProps = {
  activeProject: project,
  contextLabel: '2%',
  contextPercent: 2,
  currentThread: {
    id: 'thread_1',
    title: 'Fixture thread',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
  } satisfies RuntimeThread,
  overview,
  reviewError: null,
  reviewLoading: false,
  reviewState,
  onCollapse: () => undefined,
  onExpand: () => undefined,
  onOpenReview: () => undefined,
  onOpenThread: () => undefined,
  onReviewRefresh: () => undefined,
  threadUsage: null,
};
