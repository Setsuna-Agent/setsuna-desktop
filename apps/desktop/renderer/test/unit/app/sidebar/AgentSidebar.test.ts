// @vitest-environment happy-dom

import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { createElement, createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSidebar } from '../../../../src/app/sidebar/AgentSidebar.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { PINNED_THREADS_STORAGE_KEY, usePinnedThreads } from '../../../../src/app/sidebar/usePinnedThreads.js';
import { useThreadGroups } from '../../../../src/app/sidebar/useThreadGroups.js';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { useSidebarThreadNavigation } from '../../../../src/app/controller/useSidebarThreadNavigation.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: runtimeActivityRendererFeature }]);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('AgentSidebar project actions', () => {
  it('shows the Alt hint on the selected chat and clears it on release, window blur, or sidebar collapse', () => {
    const threads = ['first', 'second'].map((id): RuntimeThreadSummary => ({
      id, projectId: projects[0]!.id, title: id, createdAt: '', updatedAt: '',
      archived: false, messageCount: 0, lastMessagePreview: '',
    }));
    const header = (activeThreadId: string, collapsed = false) => createElement(
      I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
        ...sidebarProps(projects[0]!), activeThreadId, collapsed,
        threadsByProjectId: new Map([[projects[0]!.id, threads]]),
      }),
    );
    const view = render(header('first'));
    const sidebar = view.getByRole('complementary');
    const key = (type: 'keydown' | 'keyup', altKey: boolean) => {
      const event = new KeyboardEvent(type, { key: 'Alt', code: 'AltLeft', altKey, bubbles: true });
      // happy-dom treats Alt alone as AltGraph.
      Object.defineProperty(event, 'getModifierState', { value: () => false });
      act(() => window.dispatchEvent(event));
    };
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
    key('keydown', true);
    expect(sidebar.getAttribute('data-navigation-hint')).toBe('true');
    const hint = () => sidebar.querySelector('.desktop-agent-session__navigation-hint')!;
    expect(hint().closest('.desktop-agent-session')?.textContent).toContain('first');
    view.rerender(header('second'));
    expect(sidebar.querySelectorAll('.desktop-agent-session__navigation-hint')).toHaveLength(1);
    expect(hint().closest('.desktop-agent-session')?.textContent).toContain('second');
    key('keyup', false);
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
    key('keydown', true);
    fireEvent(window, new Event('blur'));
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
    key('keydown', true);
    fireEvent(document, new Event('visibilitychange'));
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
    key('keydown', true);
    view.rerender(header('second', true));
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
    view.rerender(header('second'));
    expect(sidebar.hasAttribute('data-navigation-hint')).toBe(false);
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
    render(createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, props)));
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
  });

  it('renders the shared project creation and editing entries', () => {
    const project: WorkspaceProject = {
      id: 'project_test',
      name: 'test-project',
      path: '/workspace/test-project',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    const sidebar = createElement(AgentSidebar, { ...sidebarProps(project), projectActionMenuId: project.id });
    const { container } = render(createElement(
      I18nProvider,
      { initialLocale: 'zh-CN', messageCatalog },
      sidebar,
    ));
    const html = container.innerHTML;

    expect(html).toContain('aria-label="新建项目"');
    expect(html).toContain('aria-label="在 test-project 中新建会话"');
    expect(html).toContain('>编辑项目</button>');
    expect(html).toContain('>归档项目</button>');
    expect(html).toContain('>插件</span>');
    expect(html).toContain('aria-label="更多操作"');
    expect(html).toContain('>运行中心</button>');
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
    expect([...pinned.querySelectorAll('.desktop-agent-session__select')].map((row) => row.textContent))
      .toEqual(['Conversation 1', 'Conversation 0']);
    expect(pinned.compareDocumentPosition(projectNode('Project A')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(projectNode('Project A')).queryByRole('button', { name: 'Conversation 0' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Conversation 0' })).toHaveLength(1);
    expect(pinned.querySelector('.desktop-agent-session.is-active')).toBeNull();
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
    expect(unpin.getAttribute('aria-pressed')).toBe('true');
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

function SidebarHarness({ threads, onSelect }: { threads: RuntimeThreadSummary[]; onSelect: (id: string) => void }) {
  const { globalThreads, threadsByProjectId } = useThreadGroups(threads);
  const { pinnedThreads, pinnedThreadIds, togglePinnedThread } = usePinnedThreads(projects, threadsByProjectId, globalThreads);
  return createElement(I18nProvider, { initialLocale: 'zh-CN', messageCatalog }, createElement(AgentSidebar, {
    ...sidebarProps(projects[0]!), projects, globalThreads, threadsByProjectId, pinnedThreads, pinnedThreadIds,
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
    onEnterChatMode: noop,
    onEditProject: noop,
    onOpenCapabilities: noop,
    onOpenRuntimeActivity: noop,
    onOpenSettings: noop,
    onRemoveProject: noop,
    onRenameThread: noop,
    onResizeStart: noop,
    onResizeStep: noop,
    onCreateProject: noop,
    onSelectProject: noop,
    onSelectThread: noop,
    onToggleProjectActions: noop,
    onToggleProjectsCollapsed: noop,
    onToggleSearch: noop,
    onToggleSessionsCollapsed: noop,
    onToggleThreadActions: noop,
    onToggleThreadPin: noop,
    runtimeActivityTriggerRef: createRef<HTMLButtonElement>(),
  };
}
