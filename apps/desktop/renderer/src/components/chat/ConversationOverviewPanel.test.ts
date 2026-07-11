import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopDiffSummary, DesktopReviewState } from '../workspace/model.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationOverviewPanel } from './ConversationOverviewPanel.js';

describe('ConversationOverviewPanel', () => {
  it('uses the same git change summary in compact and expanded modes', () => {
    const compactHtml = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: true,
    }));
    const expandedHtml = renderToStaticMarkup(createElement(ConversationOverviewPanel, {
      ...baseProps,
      compact: false,
    }));

    expect(compactHtml).toContain('变更');
    expect(compactHtml).toContain('aria-label="展开对话环境信息"');
    expect(compactHtml).toContain('+71');
    expect(compactHtml).toContain('-247');
    expect(expandedHtml).toContain('变更');
    expect(expandedHtml).toContain('+71');
    expect(expandedHtml).toContain('-247');
    expect(expandedHtml).not.toContain('无变更');
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
  unstagedSummary: null,
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
  onOpenFiles: () => undefined,
  onOpenReview: () => undefined,
  onOpenThread: () => undefined,
  onReviewRefresh: () => undefined,
  threadUsage: null,
  threads: [],
};
