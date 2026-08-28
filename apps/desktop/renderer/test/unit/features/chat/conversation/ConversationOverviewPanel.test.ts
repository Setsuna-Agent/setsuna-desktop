import type { RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { RuntimeActivityRendererService } from '@setsuna-desktop/feature-runtime-activity/contracts';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import { createNoopUsageRendererStateService } from '@setsuna-desktop/feature-usage/contracts';
import { usageRendererFeature } from '@setsuna-desktop/feature-usage/renderer';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { RuntimeActivityFeatureServiceBoundary } from '../../../../../src/composition/RuntimeActivityFeatureBoundary.js';
import { UsageFeatureServiceBoundary } from '../../../../../src/composition/UsageFeatureBoundary.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../../src/shared/i18n/messages.js';
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
      reviewControls: createElement('span', null, '加载中'),
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
      reviewControls: createElement('span', null, '加载失败'),
      reviewError: 'git status failed',
      reviewState: null,
    });

    expect(html.match(/加载失败/g)).toHaveLength(2);
    expect(html).toContain('title="git status failed"');
    expect(html).not.toContain('无变更');
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

  it('omits usage diagnostics when the optional Usage feature is unavailable', () => {
    const html = renderOverviewPanel({ ...baseProps, compact: false });

    expect(html).not.toContain('用量与诊断');
    expect(html).not.toContain('0 · 0% · 0 次');
  });

});

const messageCatalog = composeRendererMessages(hostMessages, [
  { module: runtimeActivityRendererFeature },
  { module: usageRendererFeature },
]);

function renderOverviewPanel(
  props: Parameters<typeof ConversationOverviewPanel>[0],
): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN', messageCatalog },
    renderFeatureBoundaries(createElement(ConversationOverviewPanel, props)),
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
    { initialLocale: 'zh-CN', messageCatalog },
    renderFeatureBoundaries(createElement(Capture)),
  ));
  if (!captured.panel) throw new Error('Conversation overview panel did not render.');
  return captured.panel;
}

function renderFeatureBoundaries(children: ReactNode): ReactNode {
  return createElement(UsageFeatureServiceBoundary, {
    service: createNoopUsageRendererStateService(),
    children: createElement(RuntimeActivityFeatureServiceBoundary, {
      service: noopRuntimeActivityService,
      children: createElement(ToastProvider, null, children),
    }),
  });
}

const noopRuntimeActivityService: RuntimeActivityRendererService = {
  list: async () => ({
    backgroundServices: [],
    capturedAt: '2026-07-01T00:00:00.000Z',
    tasks: [],
  }),
  listServices: async () => ({ services: [] }),
  stopService: async () => ({ terminated: false }),
  stopTask: async () => ({ cancelled: false }),
};

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
  reviewControls: createElement('span'),
  reviewError: null,
  reviewState,
  onCollapse: () => undefined,
  onExpand: () => undefined,
  onOpenReview: () => undefined,
  onOpenThread: () => undefined,
};
