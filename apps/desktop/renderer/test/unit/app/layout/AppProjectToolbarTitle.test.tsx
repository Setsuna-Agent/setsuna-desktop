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

  it('offers rename and archive actions for the active project', () => {
    const onArchiveProject = vi.fn();
    const onRenameThread = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(
      <AppProjectToolbarTitle
        project={project}
        title="Current thread"
        onArchiveProject={onArchiveProject}
        onRenameThread={onRenameThread}
      />,
    );

    expect(view.container.querySelector('.app-project-toolbar-title__project-icon')).toBeTruthy();
    expect(screen.getByText('Current thread')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '项目操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    expect(onRenameThread).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '项目操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '归档项目' }));
    expect(window.confirm).toHaveBeenCalledWith(
      '确认归档项目「test-project」？项目下的全部对话也会归档，本地文件不会被删除。',
    );
    expect(onArchiveProject).toHaveBeenCalledWith(project);
  });
});
