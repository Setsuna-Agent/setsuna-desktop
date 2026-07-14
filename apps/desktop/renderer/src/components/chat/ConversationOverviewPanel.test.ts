import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopDiffSummary, DesktopReviewState } from '../workspace/model.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationOverviewPanel } from './ConversationOverviewPanel.js';

describe('ConversationOverviewPanel', () => {
  it('uses the same local git change summary in compact and expanded modes', () => {
    const localReviewState: DesktopReviewState = {
      ...reviewState,
      stagedSummary: {
        additions: 3,
        deletions: 5,
        files: [{ ...gitSummary.files[0], path: 'README.md', additions: 3, deletions: 5 }],
      },
    };
    const compactHtml = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: true,
      reviewState: localReviewState,
    }));
    const expandedHtml = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
      reviewState: localReviewState,
    }));

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
    const html = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
      reviewState: unbornReviewState,
    }));

    expect(html).toContain('+71');
    expect(html).toContain('-247');
    expect(html).not.toContain('1 个文件');
    expect(html).not.toContain('无变更');
  });

  it('does not forward the React click event to the review callback', () => {
    const onOpenReview = vi.fn();
    const panel = ConversationOverviewPanel({
      ...baseProps,
      compact: false,
      onOpenReview,
    });
    const actions = panel.props.children[1];
    const reviewButton = actions.props.children[0];

    reviewButton.props.onClick({ type: 'click' });

    expect(onOpenReview).toHaveBeenCalledWith();
  });

  it('combines usage and diagnostics, with collaboration count on its section title', () => {
    const html = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
      currentThread: {
        ...baseProps.currentThread,
        turns: [{ id: 'turn_1', items: [], status: 'completed', modelVerifications: [{}] }],
      },
      threadUsage: {
        records: [],
        summary: { inputTokens: 900, outputTokens: 600, totalTokens: 1500, recordCount: 2, byProvider: [], byModel: [] },
      },
      threads: [{
        id: 'child_1',
        parentThreadId: 'thread_1',
        title: 'Child agent',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        archived: false,
        messageCount: 1,
        lastMessagePreview: 'working',
      }],
    }));

    expect(html).toContain('用量与诊断');
    expect(html).toContain('1.5K · 2 次 · 已完成 · 1 次验证');
    expect(html).not.toContain('1 个子 Agent');
    expect(html).toContain('协作任务');
    expect(html).toContain('aria-label="1 个协作任务"');
    expect(html).toContain('Child agent');
  });

  it('does not treat a forked conversation as a collaboration task', () => {
    const html = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
      threads: [{
        id: 'fork_1',
        forkedFromId: 'thread_1',
        title: 'Forked conversation',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        archived: false,
        messageCount: 0,
        lastMessagePreview: '',
      }],
    }));

    expect(html).not.toContain('协作任务');
    expect(html).not.toContain('Forked conversation');
  });

  it('summarizes plan progress in one row and keeps the full plan in a hover popover', () => {
    const html = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
      overview: {
        ...overview,
        planItems: [
          { step: '读取现有实现', status: 'completed' },
          { step: '整理交互结构', status: 'completed' },
          { step: '实现计划摘要', status: 'in_progress' },
          { step: '补充浮层样式', status: 'pending' },
          { step: '添加测试', status: 'pending' },
          { step: '运行验证', status: 'pending' },
        ],
      },
    }));

    expect(html).toContain('aria-label="计划推进中，已完成 2/6"');
    expect(html).toContain('chat-conversation-overview-panel__plan-loading');
    expect(html).toContain('chat-conversation-overview-panel__plan-popover');
    expect(html).toContain('计划详情');
    expect(html).toContain('实现计划摘要');
    expect(html.match(/>2\/6</g)).toHaveLength(2);
  });
});

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
  workspaceRoot: project.path,
  gitRoot: project.path,
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
  reviewLoading: false,
  reviewState,
  onCollapse: () => undefined,
  onExpand: () => undefined,
  onOpenReview: () => undefined,
  onOpenThread: () => undefined,
  onReviewRefresh: () => undefined,
  threadUsage: null,
  threads: [],
};
