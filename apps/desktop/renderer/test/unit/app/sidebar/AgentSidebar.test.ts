// @vitest-environment happy-dom

import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSidebar } from '../../../../src/app/sidebar/AgentSidebar.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { PINNED_THREADS_STORAGE_KEY, usePinnedThreads } from '../../../../src/app/sidebar/usePinnedThreads.js';
import { useThreadGroups } from '../../../../src/app/sidebar/useThreadGroups.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: runtimeActivityRendererFeature }]);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('AgentSidebar project actions', () => {
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
    expect(html).toContain('class="desktop-agent-project is-menu-open"');
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
    expect(unpin.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
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
