// @vitest-environment happy-dom

import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppChatToolbarTitle } from '../../../../src/app/layout/AppChatToolbarTitle.js';
import { SidebarThreadRow } from '../../../../src/app/sidebar/SidebarThreadRow.js';
import { usePinnedThreads } from '../../../../src/app/sidebar/usePinnedThreads.js';
import type { ThreadMenuOptions } from '../../../../src/app/thread-menu/threadMenuItems.js';

const project: WorkspaceProject = {
  id: 'project_test', name: 'test-project', path: '/workspace/test-project', createdAt: '', updatedAt: '',
};
const thread: RuntimeThreadSummary = {
  id: 'current-thread', title: 'Current thread', archived: false,
  createdAt: '', updatedAt: '', messageCount: 2, lastMessagePreview: 'Answer',
};
const apps = [{ id: 'vscode', label: 'VS Code', icon: 'vscode' }];

function menuOptions(overrides: Partial<ThreadMenuOptions> = {}): ThreadMenuOptions {
  return {
    thread, pinned: false, running: false,
    actions: { canFork: true, canCreateWorktree: true, apps,
      fork: vi.fn(async () => undefined), openWith: vi.fn(async () => undefined), deleteThread: vi.fn(async () => undefined), close: vi.fn() },
    onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onOpenInNewWindow: vi.fn(),
    ...overrides,
  };
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: '对话操作' }), { key: 'ArrowDown' });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe.each([
  { scope: 'project', activeProject: project },
  { scope: 'projectless', activeProject: null },
])('AppChatToolbarTitle ($scope)', ({ activeProject }) => {
  it.each([
    ['重命名', 'onRename'], ['归档对话', 'onArchive'], ['在新窗口打开', 'onOpenInNewWindow'],
  ] as const)('dispatches %s to the current thread and closes the menu', async (label, action) => {
    const menu = menuOptions();
    render(<AppChatToolbarTitle project={activeProject} title={thread.title} menu={menu} />);
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    expect(menu[action]).toHaveBeenCalledExactlyOnceWith(action === 'onOpenInNewWindow' ? thread.id : thread);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

it('shares pin and unpin state with the sidebar immediately', async () => {
  const menu = menuOptions();
  const groups = new Map<string, RuntimeThreadSummary[]>();
  function Harness() {
    const { pinnedThreadIds, togglePinnedThread } = usePinnedThreads([], groups, [thread]);
    const pinned = pinnedThreadIds.has(thread.id);
    return <>
      <AppChatToolbarTitle title={thread.title} menu={{ ...menu, pinned, onTogglePin: togglePinnedThread }} />
      <SidebarThreadRow thread={thread} variant="global" selected={false} menuOpen={false}
        pinned={pinned} threadMenu={menu.actions} onTogglePin={togglePinnedThread}
        onRename={menu.onRename} onArchive={menu.onArchive} onOpenInNewWindow={menu.onOpenInNewWindow}
        onSelect={vi.fn()} onToggleMenu={vi.fn()} />
    </>;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '对话操作' }));
  await user.click(await screen.findByRole('menuitem', { name: '置顶对话' }));
  expect(screen.getByRole('button', { name: '取消置顶' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '对话操作' }));
  await user.click(await screen.findByRole('menuitem', { name: '取消置顶' }));
  expect(screen.getByRole('button', { name: '置顶对话' })).toBeTruthy();
});

it.each([
  ['分叉', '在此工作区中创建分支', 'fork', 'workspace'],
  ['分叉', '在新工作树中创建分支', 'fork', 'worktree'],
  ['打开方式', 'VS Code', 'openWith', 'vscode'],
] as const)('dispatches %s / %s and closes both menus', async (parent, child, action, argument) => {
  const menu = menuOptions();
  render(<AppChatToolbarTitle title={thread.title} menu={menu} />);
  openMenu();
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: parent }), { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('menuitem', { name: child }));
  expect(menu.actions[action]).toHaveBeenCalledExactlyOnceWith(argument);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('blocks archive and fork while running but still allows a new window', async () => {
  const menu = menuOptions({ running: true });
  render(<AppChatToolbarTitle title={thread.title} menu={menu} />);
  openMenu();
  const archive = await screen.findByRole('menuitem', { name: '归档对话' });
  fireEvent.click(archive);
  expect(archive.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: '分叉' }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: '彻底删除' }).getAttribute('aria-disabled')).toBe('true');
  expect(menu.onArchive).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: '在新窗口打开' }));
  expect(menu.onOpenInNewWindow).toHaveBeenCalledExactlyOnceWith(thread.id);
});

it('keeps thread operations unavailable on a new conversation while allowing workspace apps', async () => {
  const menu = menuOptions({ thread: null });
  render(<AppChatToolbarTitle project={project} title="New thread" menu={menu} />);
  openMenu();
  for (const name of ['重命名', '置顶对话', '归档对话', '彻底删除', '分叉', '在新窗口打开']) {
    const item = await screen.findByRole('menuitem', { name });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
  }
  expect(menu.onRename).not.toHaveBeenCalled();
  expect(menu.onTogglePin).not.toHaveBeenCalled();
  expect(menu.onArchive).not.toHaveBeenCalled();
  expect(menu.onOpenInNewWindow).not.toHaveBeenCalled();
  expect(menu.actions.fork).not.toHaveBeenCalled();
  expect(menu.actions.deleteThread).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '打开方式' }), { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'VS Code' }));
  expect(menu.actions.openWith).toHaveBeenCalledExactlyOnceWith('vscode');
});

it('disables open-with when no apps are available', async () => {
  const menu = menuOptions();
  menu.actions.apps = [];
  render(<AppChatToolbarTitle title={thread.title} menu={menu} />);
  openMenu();
  const openWith = await screen.findByRole('menuitem', { name: '打开方式' });
  expect(openWith.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(openWith);
  expect(menu.actions.openWith).not.toHaveBeenCalled();
});
