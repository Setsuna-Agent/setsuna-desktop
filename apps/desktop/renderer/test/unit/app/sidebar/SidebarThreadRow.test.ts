// @vitest-environment happy-dom

import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState, type ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import type { ThreadMenuState } from '../../../../src/app/thread-menu/useThreadMenu.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarThreadRow } from '../../../../src/app/sidebar/SidebarThreadRow.js';

afterEach(cleanup);

describe('SidebarThreadRow', () => {
  it.each([
    ['重命名', 'onRename', false],
    ['置顶对话', 'onTogglePin', false],
    ['取消置顶', 'onTogglePin', true],
    ['归档对话', 'onArchive', false],
    ['在新窗口打开', 'onOpenInNewWindow', false],
  ] as const)('dispatches %s to the context target without selecting it and closes the menu', async (label, action, pinned) => {
    const actions = { onRename: vi.fn(), onTogglePin: vi.fn(), onArchive: vi.fn(), onOpenInNewWindow: vi.fn() };
    const onSelect = vi.fn();
    const onToggleMenu = vi.fn();
    const threadMenu = menuActions();
    const view = await renderContextRow({
      ...actions, threadMenu, onSelect, onToggleMenu, thread, pinned, menuOpen: true, selected: false, variant: 'project',
    });
    await userEvent.setup().click(view.getByRole('menuitem', { name: label }));
    expect(actions[action]).toHaveBeenCalledExactlyOnceWith(action === 'onOpenInNewWindow' ? thread.id : thread);
    expect(threadMenu.close).toHaveBeenCalledOnce();
    expect(onToggleMenu).toHaveBeenCalledExactlyOnceWith(thread.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['分叉', '在此工作区中创建分支', 'fork', 'workspace'],
    ['分叉', '在新工作树中创建分支', 'fork', 'worktree'],
    ['打开方式', 'VS Code', 'openWith', 'vscode'],
  ] as const)('dispatches %s / %s through the submenu without selecting the conversation', async (parent, child, action, argument) => {
    const threadMenu = menuActions();
    const onSelect = vi.fn();
    const view = await renderContextRow({
      thread, threadMenu, menuOpen: true, selected: false, variant: 'project', onSelect,
      onArchive: vi.fn(), onOpenInNewWindow: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn(), onToggleMenu: vi.fn(),
    });
    const user = userEvent.setup();
    view.getByRole('menuitem', { name: parent }).focus();
    await user.keyboard('{ArrowRight}');
    await user.click(await view.findByRole('menuitem', { name: child }));
    expect(threadMenu[action]).toHaveBeenCalledExactlyOnceWith(argument);
    expect(threadMenu.close).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('blocks archiving a running conversation from the context menu while allowing a new window', async () => {
    const onArchive = vi.fn();
    const onOpenInNewWindow = vi.fn();
    const view = await renderContextRow({
      thread: { ...thread, activeTurnId: 'turn-1' }, menuOpen: true, selected: false, variant: 'project',
      threadMenu: menuActions(), onArchive, onOpenInNewWindow, onRename: vi.fn(), onTogglePin: vi.fn(), onSelect: vi.fn(), onToggleMenu: vi.fn(),
    });
    fireEvent.click(view.getByRole('menuitem', { name: '归档对话' }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(view.getByRole('menuitem', { name: '彻底删除' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(view.getByRole('menuitem', { name: '在新窗口打开' }));
    expect(onOpenInNewWindow).toHaveBeenCalledExactlyOnceWith(thread.id);
  });

  it('passes the right-clicked conversation to the permanent-delete flow without selecting it', async () => {
    const threadMenu = menuActions();
    const onSelect = vi.fn();
    const view = await renderContextRow({
      thread, threadMenu, menuOpen: false, selected: false, variant: 'project', onSelect,
      onArchive: vi.fn(), onOpenInNewWindow: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn(), onToggleMenu: vi.fn(),
    });
    await userEvent.setup().click(view.getByRole('menuitem', { name: '彻底删除' }));
    expect(threadMenu.deleteThread).toHaveBeenCalledExactlyOnceWith(thread);
    expect(threadMenu.close).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(['outside', 'escape'] as const)('dismisses with %s without selecting a chat, then restores sidebar interaction', async (dismiss) => {
    const onSelect = vi.fn();
    const threadMenu = menuActions();
    const view = await renderContextRow({
      thread, threadMenu, menuOpen: false, selected: false, variant: 'project', onSelect,
      onArchive: vi.fn(), onOpenInNewWindow: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn(), onToggleMenu: vi.fn(),
    });
    const user = userEvent.setup();
    if (dismiss === 'escape') await user.keyboard('{Escape}');
    else await user.click(document.documentElement);
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
    expect(threadMenu.close).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(view.getByRole('button', { name: thread.title }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(thread.id);
  });

  it.each([
    { source: 'runtime snapshot', activeTurnId: 'turn_goal_1', running: false },
    { source: 'current-thread fallback', activeTurnId: undefined, running: true },
  ])('makes archiving unavailable while the $source is running, then restores the action', ({ activeTurnId, running }) => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    const row = (value: RuntimeThreadSummary, isRunning = false) => createElement(SidebarThreadRow, {
      menuOpen: false,
      threadMenu: menuActions(),
      running: isRunning,
      selected: false,
      thread: value,
      variant: 'project',
      onArchive,
      onOpenInNewWindow: () => undefined,
      onRename: () => undefined,
      onSelect,
      onToggleMenu: () => undefined,
      onTogglePin: () => undefined,
    });
    const view = render(row(thread));
    expect(view.getByRole('button', { name: '归档对话' })).toBeTruthy();

    view.rerender(row({ ...thread, activeTurnId }, running));
    expect(view.getByRole('status', { name: '对话进行中' })).toBeTruthy();
    expect(view.queryByRole('button', { name: '归档对话', hidden: true })).toBeNull();
    expect(onArchive).not.toHaveBeenCalled();

    view.rerender(row(thread));
    fireEvent.click(view.getByRole('button', { name: '归档对话' }));
    expect(onArchive).toHaveBeenCalledExactlyOnceWith(thread);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

const thread: RuntimeThreadSummary = {
  id: 'thread_1',
  title: 'Running thread',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  archived: false,
  messageCount: 0,
  lastMessagePreview: '',
};

function menuActions(): ThreadMenuState {
  return { canFork: true, canCreateWorktree: true, apps: [{ id: 'vscode', label: 'VS Code', icon: 'code' }],
    fork: vi.fn(async () => undefined), openWith: vi.fn(async () => undefined), deleteThread: vi.fn(async () => undefined), close: vi.fn() };
}

async function renderContextRow(props: ComponentProps<typeof SidebarThreadRow>) {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(SidebarThreadRow, { ...props, menuOpen: open,
      onToggleMenu: (id) => { props.onToggleMenu(id); setOpen(true); },
      threadMenu: { ...props.threadMenu, close: () => { props.threadMenu.close(); setOpen(false); } },
    });
  }
  const view = render(createElement(Harness));
  const opener = view.getByRole('button', { name: props.thread.title });
  opener.focus();
  fireEvent.contextMenu(opener, { clientX: 40, clientY: 60 });
  const menu = await view.findByRole('menu');
  fireEvent.keyDown(menu, { key: 'Home' });
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole('menuitem', { name: '重命名' })));
  return view;
}
