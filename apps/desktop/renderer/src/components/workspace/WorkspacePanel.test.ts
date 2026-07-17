import { describe, expect, it, vi } from 'vitest';
import { temporaryWorkspaceProjectId, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { WorkspaceOverviewPanel } from './WorkspacePanel.js';

describe('WorkspaceOverviewPanel', () => {
  it('does not forward the React click event to the review callback', () => {
    const onOpenReviewPanel = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenFilesPanel: () => undefined,
      onOpenBrowser: () => undefined,
      onOpenReviewPanel,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const reviewButton = panel.props.children.props.children[0];

    reviewButton.props.onClick({ type: 'click' });

    expect(onOpenReviewPanel).toHaveBeenCalledWith();
  });

  it('opens side chat from the workspace overview menu', () => {
    const onOpenSideChat = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenFilesPanel: () => undefined,
      onOpenBrowser: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat,
      onOpenTerminalPanel: () => undefined,
    });
    const sideChatButton = panel.props.children.props.children[3];

    sideChatButton.props.onClick();

    expect(onOpenSideChat).toHaveBeenCalledOnce();
  });

  it('opens the browser from the workspace overview menu', () => {
    const onOpenBrowser = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenBrowser,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const browserButton = panel.props.children.props.children[4];

    browserButton.props.onClick();

    expect(onOpenBrowser).toHaveBeenCalledOnce();
  });

  it('在普通对话的临时目录中开放工作区操作', () => {
    const panel = WorkspaceOverviewPanel({
      activeProject: {
        ...project,
        id: temporaryWorkspaceProjectId({ date: '2026-07-18', threadId: 'thread_1' }),
        name: '临时目录',
      },
      latestReviewSummary: null,
      onOpenBrowser: () => undefined,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const actions = panel.props.children.props.children;

    expect(actions.slice(0, 3).every((action: { props: { disabled: boolean } }) => !action.props.disabled)).toBe(true);
    expect(actions[2].props.children[1].props.children[1].props.children).toBe('临时目录 Shell');
  });
});

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};
