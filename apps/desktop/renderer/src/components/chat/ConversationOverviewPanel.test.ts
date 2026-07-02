import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
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
  overview,
  reviewLoading: false,
  reviewState,
  onCollapse: () => undefined,
  onExpand: () => undefined,
  onOpenFiles: () => undefined,
  onOpenReview: () => undefined,
  onReviewRefresh: () => undefined,
};
