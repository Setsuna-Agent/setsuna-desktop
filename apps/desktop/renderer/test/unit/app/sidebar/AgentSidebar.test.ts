// @vitest-environment happy-dom

import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import { act, cleanup, fireEvent, render as renderUi, renderHook, screen, within } from '@testing-library/react';
import { createElement, createRef, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSidebar } from '../../../../src/app/sidebar/AgentSidebar.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { PINNED_THREADS_STORAGE_KEY, usePinnedThreads } from '../../../../src/app/sidebar/usePinnedThreads.js';
import { PINNED_PROJECTS_STORAGE_KEY, usePinnedProjects } from '../../../../src/app/sidebar/usePinnedProjects.js';
import { useThreadGroups } from '../../../../src/app/sidebar/useThreadGroups.js';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { useSidebarThreadNavigation } from '../../../../src/app/controller/useSidebarThreadNavigation.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: runtimeActivityRendererFeature }]);
const render = (element: ReactElement) => renderUi(element, { wrapper: ToastProvider });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('AgentSidebar project actions', () => {
  it('pins an entire project persistently while preserving independently pinned chats and their ownership', () => {
    const threads: RuntimeThreadSummary[] = ['child', 'individual'].map((id) => ({
      id, projectId: projects[0]!.id, title: id, createdAt: '', updatedAt: '',
      archived: false, messageCount: 0, lastMessagePreview: '',
    }));
    localStorage.setItem(PINNED_THREADS_STORAGE_KEY, JSON.stringify(['individual']));
    const onSelect = vi.fn();
    const element = (visibleProjects = projects, visibleThreads = threads) => createElement(SidebarHarness, {
      threads: visibleThreads, onSelect, visibleProjects,
    });
    const projectNode = () => screen.getByRole('button', { name: 'Project A' })
      .closest('.desktop-agent-project-node') as HTMLElement;
    let view = render(element());
    fireEvent.click(within(projectNode()).getByRole('menuitem', { name: '置顶' }));
    expect(JSON.parse(localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY)!)).toEqual(['project-A']);
    const pinned = screen.getByRole('region', { name: '置顶' });
    fireEvent.click(within(pinned).getByRole('button', { name: 'child' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('child');
    expect(screen.getAllByRole('button', { name: 'Project A' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'individual' })).toHaveLength(1);
    expect(within(projectNode()).queryByRole('button', { name: 'individual' })).toBeNull();

    view.unmount();
    view = render(element([]));
    expect(screen.queryByRole('region', { name: '置顶' })).toBeNull();
    const newChild = { ...threads[0]!, id: 'new-child', title: 'New child' };
    view.rerender(element(projects, [...threads, newChild]));
    fireEvent.click(within(screen.getByRole('region', { name: '置顶' })).getByRole('button', { name: 'New child' }));
    expect(onSelect).toHaveBeenLastCalledWith('new-child');
    fireEvent.click(within(projectNode()).getByRole('menuitem', { name: '取消置顶' }));
    expect(JSON.parse(localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY)!)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PINNED_THREADS_STORAGE_KEY)!)).toEqual(['individual']);
    const remainingPins = screen.getByRole('region', { name: '置顶' });
    expect(within(remainingPins).queryByRole('button', { name: 'Project A' })).toBeNull();
    fireEvent.click(within(projectNode()).getByRole('button', { name: 'child' }));
    expect(onSelect).toHaveBeenLastCalledWith('child');
    expect(threads.every((thread) => thread.projectId === 'project-A')).toBe(true);
  });

  it('merges another window’s project pins and leaves the saved selection intact when a write fails', async () => {
    const view = renderHook(() => usePinnedProjects(projects), { wrapper: ToastProvider });
    // Merge the latest persisted selection even before the storage event arrives.
    localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(['project-B']));
    act(() => view.result.current.togglePinnedProject(projects[0]!));
    expect([...view.result.current.pinnedProjectIds]).toEqual(['project-A', 'project-B']);
    const save = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    act(() => view.result.current.togglePinnedProject(projects[0]!));
    expect([...view.result.current.pinnedProjectIds]).toEqual(['project-A', 'project-B']);
    expect(JSON.parse(localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY)!)).toEqual(['project-A', 'project-B']);
    await screen.findByText('置顶设置保存失败，请重试。');
    save.mockRestore();
    act(() => {
      localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(['project-B']));
      window.dispatchEvent(new StorageEvent('storage', { key: PINNED_PROJECTS_STORAGE_KEY }));
    });
    expect([...view.result.current.pinnedProjectIds]).toEqual(['project-B']);
  });

  it('navigates only displayed rows, skipping collapsed projects, pinned groups, and rows behind show more', async () => {
    const threads = Array.from({ length: 7 }, (_, index): RuntimeThreadSummary => ({
      id: `thread-${index + 1}`, projectId: projects[0]!.id, title: `Chat ${index + 1}`,
      createdAt: '', updatedAt: '', archived: false, messageCount: 0, lastMessagePreview: '',
    }));
    const pinned = { ...threads[0]!, id: 'pinned', title: 'Pinned chat' };
    const global = { ...threads[0]!, id: 'global', projectId: undefined, title: 'Global chat' };
    let currentThreadId = 'thread-5';
    const onOpenThread = vi.fn(async (id: string) => { currentThreadId = id; });
    const shortcuts = renderHook(({ id }) => {
      const navigation = useSidebarThreadNavigation({ currentThreadId: id, onOpenThread, onError: vi.fn() });
      useAppKeyboardShortcuts({
        'navigation.previousChat': { execute: navigation.goPrevious },
        'navigation.nextChat': { execute: navigation.goNext },
      });
    }, { initialProps: { id: currentThreadId } });
    const props = {
      ...sidebarProps(projects[0]!), projects,
      pinnedThreads: [pinned], pinnedThreadIds: new Set([pinned.id]), globalThreads: [global],
      collapsedProjectIds: new Set([projects[1]!.id]),
      threadsByProjectId: new Map([
        [projects[0]!.id, [pinned, ...threads]],
        [projects[1]!.id, [{ ...threads[0]!, id: 'collapsed-chat' }]],
      ]),
    };
    const view = render(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, props)));
    const pressArrow = async (code: 'ArrowUp' | 'ArrowDown') => {
      const event = new KeyboardEvent('keydown', { key: code, code, altKey: true, bubbles: true, cancelable: true });
      // happy-dom reports Alt alone as AltGraph, unlike actual Alt+Arrow keyboard input.
      Object.defineProperty(event, 'getModifierState', { value: () => false });
      await act(async () => { document.body.dispatchEvent(event); });
      shortcuts.rerender({ id: currentThreadId });
    };

    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('global');
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-5');
    fireEvent.click(screen.getByRole('button', { name: '再显示 2 个对话' }));
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-6');
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-7');
    for (let index = 6; index >= 1; index -= 1) await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-1');
    fireEvent.click(screen.getByRole('button', { name: '置顶' }));
    const callsBeforeBoundary = onOpenThread.mock.calls.length;
    await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenCalledTimes(callsBeforeBoundary);
    fireEvent.click(screen.getByRole('button', { name: '置顶' }));
    await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenLastCalledWith('pinned');
    expect(onOpenThread).not.toHaveBeenCalledWith('collapsed-chat');

    // A closing project's rows must stop participating before their exit animation finishes.
    view.rerender(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
      ...props, collapsedProjectIds: new Set(projects.map((project) => project.id)),
    })));
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('global');
    await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenLastCalledWith('pinned');
    view.rerender(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, props)));
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('thread-1');

    await pressArrow('ArrowUp');
    view.rerender(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
      ...props, projectsCollapsed: true,
    })));
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('global');
    await pressArrow('ArrowUp');
    expect(onOpenThread).toHaveBeenLastCalledWith('pinned');
    view.rerender(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
      ...props, projectsCollapsed: true, sessionsCollapsed: true,
    })));
    const callsWithGroupsClosed = onOpenThread.mock.calls.length;
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenCalledTimes(callsWithGroupsClosed);
    view.rerender(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
      ...props, projectsCollapsed: true,
    })));
    await pressArrow('ArrowDown');
    expect(onOpenThread).toHaveBeenLastCalledWith('global');
  });

  it('receives pins from another window and preserves them when toggling a local conversation', () => {
    const thread: RuntimeThreadSummary = {
      id: 'local', title: 'Local', createdAt: '', updatedAt: '', archived: false, messageCount: 0, lastMessagePreview: '',
    };
    const view = renderHook(() => usePinnedThreads([], new Map(), [thread]), { wrapper: ToastProvider });
    act(() => {
      localStorage.setItem(PINNED_THREADS_STORAGE_KEY, JSON.stringify(['remote']));
      window.dispatchEvent(new StorageEvent('storage', { key: PINNED_THREADS_STORAGE_KEY }));
    });
    expect([...view.result.current.pinnedThreadIds]).toEqual(['remote']);
    act(() => view.result.current.togglePinnedThread(thread));
    expect([...view.result.current.pinnedThreadIds]).toEqual(['local', 'remote']);
    expect(JSON.parse(localStorage.getItem(PINNED_THREADS_STORAGE_KEY)!)).toEqual(['local', 'remote']);
  });

  it('moves chats into a persistent pinned section and restores their original project on unpin', () => {
    const threads: RuntimeThreadSummary[] = projects.map((project, index) => ({
      id: `thread-${index}`, projectId: project.id, title: `Conversation ${index}`,
      createdAt: `2026-09-0${2 - index}T00:00:00Z`, updatedAt: '',
      archived: false, messageCount: 0, lastMessagePreview: '', activeTurnId: index === 0 ? 'turn-1' : undefined,
    }));
    const onSelect = vi.fn();
    const element = (visibleThreads = threads) => createElement(SidebarHarness, { threads: visibleThreads, onSelect });
    let view = render(element());
    expect(screen.queryByRole('region', { name: '置顶' })).toBeNull();

    const projectNode = (name: string) => screen.getByRole('button', { name })
      .closest('.desktop-agent-project-node') as HTMLElement;
    fireEvent.click(within(projectNode('Project A')).getByRole('button', { name: '置顶对话' }));
    fireEvent.click(within(projectNode('Project B')).getByRole('button', { name: '置顶对话' }));

    const pinned = screen.getByRole('region', { name: '置顶' });
    expect(JSON.parse(localStorage.getItem(PINNED_THREADS_STORAGE_KEY)!)).toEqual(['thread-1', 'thread-0']);
    expect(within(projectNode('Project A')).queryByRole('button', { name: 'Conversation 0' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Conversation 0' })).toHaveLength(1);
    const pinnedHeading = within(pinned).getByRole('button', { name: '置顶' });
    fireEvent.click(pinnedHeading);
    expect(pinnedHeading.getAttribute('aria-expanded')).toBe('false');
    expect(within(pinned).queryByRole('button', { name: 'Conversation 0' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Project A' })).toBeTruthy();
    fireEvent.click(pinnedHeading);
    expect(pinnedHeading.getAttribute('aria-expanded')).toBe('true');
    expect(within(pinned).getByRole('button', { name: 'Conversation 0' })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(within(pinned).getByRole('button', { name: 'Conversation 1' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('thread-1');

    const unpin = within(pinned).getAllByRole('button', { name: '取消置顶' })[0]!;
    fireEvent.click(unpin);
    expect(within(projectNode('Project B')).getByRole('button', { name: 'Conversation 1' })).toBeTruthy();
    expect(threads[1]?.projectId).toBe(projects[1]?.id);

    view.unmount();
    view = render(element([]));
    expect(screen.queryByRole('region', { name: '置顶' })).toBeNull();
    view.rerender(element());
    expect(within(screen.getByRole('region', { name: '置顶' })).getByRole('button', { name: 'Conversation 0' })).toBeTruthy();
    view.rerender(element(threads.slice(1)));
    expect(screen.queryByRole('region', { name: '置顶' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conversation 0' })).toBeNull();
    view.rerender(element());
    fireEvent.click(screen.getByRole('button', { name: '取消置顶' }));
    expect(screen.queryByRole('region', { name: '置顶' })).toBeNull();
    expect(within(projectNode('Project A')).getByRole('button', { name: 'Conversation 0' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(PINNED_THREADS_STORAGE_KEY)!)).toEqual([]);
  });
});

const projects: WorkspaceProject[] = ['A', 'B'].map((name) => ({
  id: `project-${name}`, name: `Project ${name}`, path: `/workspace/${name}`, createdAt: '', updatedAt: '',
}));

function SidebarHarness({ threads, onSelect, visibleProjects = projects }: {
  threads: RuntimeThreadSummary[];
  onSelect: (id: string) => void;
  visibleProjects?: WorkspaceProject[];
}) {
  const { globalThreads, threadsByProjectId } = useThreadGroups(threads);
  const { pinnedThreads, pinnedThreadIds, togglePinnedThread } = usePinnedThreads(visibleProjects, threadsByProjectId, globalThreads);
  const { pinnedProjects, pinnedProjectIds, togglePinnedProject } = usePinnedProjects(visibleProjects);
  return createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
    ...sidebarProps(projects[0]!), projects: visibleProjects, globalThreads, threadsByProjectId, pinnedThreads, pinnedThreadIds,
    pinnedProjects, pinnedProjectIds, onToggleProjectPin: togglePinnedProject,
    onToggleThreadPin: togglePinnedThread, onSelectThread: onSelect,
  }));
}

function sidebarProps(project: WorkspaceProject): ComponentProps<typeof AgentSidebar> {
  const noop = () => undefined;
  return {
    activeProjectId: project.id,
    activeThreadId: null,
    activeView: 'chat',
    collapsedProjectIds: new Set<string>(),
    forceExpandedProjectIds: new Set<string>(),
    globalThreads: [],
    pinnedThreadIds: new Set<string>(),
    pinnedThreads: [],
    pinnedProjectIds: new Set<string>(),
    pinnedProjects: [],
    maxWidth: 420,
    minWidth: 180,
    projectActionMenuId: null,
    projects: [project],
    projectsCollapsed: false,
    searchOpen: false,
    searchTriggerRef: createRef<HTMLButtonElement>(),
    sessionsCollapsed: false,
    threadActionMenuId: null,
    threadsByProjectId: new Map(),
    width: 240,
    onArchiveProject: noop,
    onArchiveThread: noop,
    onCreateCurrentThread: noop,
    onCreateGlobalThread: noop,
    onCreateProjectThread: noop,
    onEditProject: noop,
    onRemoveProject: noop,
    threadMenu: { canFork: false, canCreateWorktree: false, apps: [],
      fork: async () => undefined, openWith: async () => undefined, deleteThread: async () => undefined,
      exportThread: async () => undefined, close: () => undefined },
    onOpenThreadInNewWindow: noop,
    onRenameThread: noop,
    onResizeStart: noop,
    onResizeStep: noop,
    onCreateProject: noop,
    onToggleProjectCollapsed: noop,
    onSelectThread: noop,
    onToggleProjectActions: noop,
    onToggleProjectsCollapsed: noop,
    onToggleSearch: noop,
    onToggleSessionsCollapsed: noop,
    onToggleThreadActions: noop,
    onToggleThreadPin: noop,
    onToggleProjectPin: noop,
  };
}
