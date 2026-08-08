// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { DesktopReviewPanel } from '../../../../src/features/workspace/ReviewPanel.js';
import { WorkspaceGitCommitProvider } from '../../../../src/features/workspace/git/WorkspaceGitCommitDialog.js';
import type { DesktopDiffSummary, DesktopReviewState } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('DesktopReviewPanel interactions', () => {
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
  workspaceRoot: project.path,
  gitRoot: project.path,
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
