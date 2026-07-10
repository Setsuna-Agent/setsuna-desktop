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
      onOpenReviewPanel,
      onOpenTerminalPanel: () => undefined,
    });
    const reviewButton = panel.props.children.props.children[0];

    reviewButton.props.onClick({ type: 'click' });

    expect(onOpenReviewPanel).toHaveBeenCalledWith();
  });
});

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};
