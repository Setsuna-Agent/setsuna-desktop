// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProjectToolbarTitle } from '../../../../src/app/layout/AppProjectToolbarTitle.js';

const project: WorkspaceProject = {
  id: 'project_test',
  name: 'test-project',
  path: '/workspace/test-project',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

describe('AppProjectToolbarTitle', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers rename and archive actions for the active thread', () => {
    const onArchiveThread = vi.fn();
    const onRenameThread = vi.fn();
    const view = render(
      <AppProjectToolbarTitle
        project={project}
        title="Current thread"
        onArchiveThread={onArchiveThread}
        onRenameThread={onRenameThread}
      />,
    );

    expect(view.container.querySelector('.app-project-toolbar-title__project-icon')).toBeTruthy();
    expect(screen.getByText('Current thread')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '对话操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    expect(onRenameThread).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '对话操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '归档对话' }));
    expect(onArchiveThread).toHaveBeenCalledOnce();
  });

  it('hides unavailable thread actions and disables archive while the thread is running', () => {
    const onArchiveThread = vi.fn();
    const view = render(
      <AppProjectToolbarTitle project={project} title="New thread" />,
    );

    expect(screen.queryByRole('button', { name: '对话操作' })).toBeNull();

    view.rerender(
      <AppProjectToolbarTitle
        project={project}
        title="Running thread"
        archiveThreadDisabled
        onArchiveThread={onArchiveThread}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '对话操作' }));
    const archiveAction = screen.getByRole('menuitem', { name: '归档对话' });
    expect(archiveAction.hasAttribute('disabled')).toBe(true);
    fireEvent.click(archiveAction);
    expect(onArchiveThread).not.toHaveBeenCalled();
  });
});
