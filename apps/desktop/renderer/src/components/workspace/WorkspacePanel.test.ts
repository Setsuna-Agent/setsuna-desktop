import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
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
});

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};
