// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppChatToolbarTitle } from '../../../../src/app/layout/AppChatToolbarTitle.js';

const project: WorkspaceProject = {
  id: 'project_test',
  name: 'test-project',
  path: '/workspace/test-project',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each([
  { scope: 'project', activeProject: project },
  { scope: 'projectless', activeProject: null },
])('AppChatToolbarTitle ($scope)', ({ activeProject }) => {
  it('offers rename and archive actions for the active thread', async () => {
    const onArchiveThread = vi.fn();
    const onRenameThread = vi.fn();
    const view = render(
      <AppChatToolbarTitle
        project={activeProject}
        title="Current thread"
        onArchiveThread={onArchiveThread}
        onRenameThread={onRenameThread}
      />,
    );

    expect(Boolean(view.container.querySelector('.app-chat-toolbar-title__project-icon'))).toBe(Boolean(activeProject));
    expect(screen.getByText('Current thread')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
    expect(onRenameThread).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '归档对话' }));
    expect(onArchiveThread).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('hides unavailable thread actions and disables archive while the thread is running', async () => {
    const onArchiveThread = vi.fn();
    const view = render(
      <AppChatToolbarTitle project={activeProject} title="New thread" />,
    );

    expect(screen.queryByRole('button', { name: '对话操作' })).toBeNull();

    view.rerender(
      <AppChatToolbarTitle
        project={activeProject}
        title="Running thread"
        archiveThreadDisabled
        onArchiveThread={onArchiveThread}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
    const archiveAction = await screen.findByRole('menuitem', { name: '归档对话' });
    expect(archiveAction.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(archiveAction);
    expect(onArchiveThread).not.toHaveBeenCalled();
  });
});

it('opens a workspace app from the nested conversation menu and closes both menus', async () => {
  const onOpenWorkspaceInApp = vi.fn();
  const apps = [{ id: 'vscode', label: 'VS Code', icon: 'vscode' }, { id: 'cursor', label: 'Cursor', icon: 'cursor' }];
  render(<AppChatToolbarTitle project={project} title="Current thread" workspaceApps={apps}
    selectedWorkspaceApp={apps[0]} onOpenWorkspaceInApp={onOpenWorkspaceInApp} />);

  fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
  const openWith = await screen.findByRole('menuitem', { name: '打开方式' });
  fireEvent.keyDown(openWith, { key: 'ArrowRight' });
  const selectedApp = await screen.findByRole('menuitem', { name: 'VS Code' });
  expect(selectedApp.classList.contains('is-selected')).toBe(true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cursor' }));
  expect(onOpenWorkspaceInApp).toHaveBeenCalledExactlyOnceWith('cursor');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('disables open-with without installed apps and hides it without a workspace action', async () => {
  const onOpenWorkspaceInApp = vi.fn();
  const view = render(<AppChatToolbarTitle title="New thread" onOpenWorkspaceInApp={onOpenWorkspaceInApp} />);
  fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
  const openWith = await screen.findByRole('menuitem', { name: '打开方式' });
  expect(openWith.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(openWith);
  expect(onOpenWorkspaceInApp).not.toHaveBeenCalled();
  view.rerender(<AppChatToolbarTitle title="Global thread" onRenameThread={vi.fn()} />);
  expect(screen.queryByRole('menuitem', { name: '打开方式' })).toBeNull();
});
