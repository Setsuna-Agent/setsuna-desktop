// @vitest-environment happy-dom
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createRef, type ComponentProps, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentSidebar } from '../../../../src/app/sidebar/AgentSidebar.js';
import { SidebarOrderProvider, useSidebarOrder } from '../../../../src/app/sidebar/SidebarOrderProvider.js';
import { SIDEBAR_ORDER_STORAGE_KEY, parseSidebarOrders } from '../../../../src/app/sidebar/sidebarOrder.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { readThreadReferenceDrag } from '../../../../src/shared/lib/threadReferenceDrag.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const projects: WorkspaceProject[] = ['a', 'b', 'c'].map((id) => ({
  id, name: `Project ${id}`, path: `/workspace/${id}`, createdAt: '', updatedAt: '',
}));
const chat = (id: string, projectId?: string): RuntimeThreadSummary => ({
  id, projectId, title: `Chat ${id}`, createdAt: '', updatedAt: '', archived: false,
  messageCount: 0, lastMessagePreview: '',
});
const projectChats = Array.from({ length: 6 }, (_, i) => chat(`a${i + 1}`, 'a'));

function fixture() {
  const noop = vi.fn();
  const props: ComponentProps<typeof AgentSidebar> = {
    activeProjectId: null, activeView: 'chat', collapsedProjectIds: new Set(), forceExpandedProjectIds: new Set(),
    globalThreads: ['g1', 'g2', 'p1', 'p2'].map((id) => chat(id)),
    pinnedThreads: [chat('p1'), chat('p2')], pinnedThreadIds: new Set(['p1', 'p2']),
    projects, projectActionMenuId: null, projectsCollapsed: false,
    searchOpen: false, searchTriggerRef: createRef(), sessionsCollapsed: false, threadActionMenuId: null,
    threadsByProjectId: new Map([['a', projectChats], ['b', [chat('b1', 'b'), chat('b2', 'b')]]]),
    width: 240, minWidth: 180, maxWidth: 420,
    onArchiveThread: noop, onArchiveProject: noop, onCreateCurrentThread: noop, onCreateGlobalThread: noop,
    onCreateProjectThread: noop, onEditProject: noop, onRemoveProject: noop, onResizeStep: noop,
    onResizeStart: noop, onCreateProject: noop, onToggleProjectCollapsed: noop, onSelectThread: noop,
    onToggleProjectActions: noop, onToggleProjectsCollapsed: noop, onToggleSearch: noop,
    onToggleSessionsCollapsed: noop, onToggleThreadActions: noop, onToggleThreadPin: noop,
    onOpenThreadInNewWindow: noop, onRenameThread: noop,
    threadMenu: { canFork: false, canCreateWorktree: false, apps: [], fork: async () => undefined,
      openWith: async () => undefined, deleteThread: async () => undefined, close: noop },
  };
  return { ...render(<ToastProvider><AgentSidebar {...props} /></ToastProvider>), props, noop };
}

function transfer() {
  const values = new Map<string, string>();
  return {
    get types() { return [...values.keys()]; },
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none',
  } as unknown as DataTransfer;
}

function drag(type: string, node: HTMLElement, dataTransfer: DataTransfer, clientY = -1) {
  // happy-dom omits mouse coordinates from DragEvent; supply the native event shape.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return fireEvent(node, event);
}
const button = (name: string) => screen.getByRole('button', { name });
const saved = () => parseSidebarOrders(localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY));

it('commits project order only on drop without opening or collapsing a project', () => {
  const view = fixture();
  const data = transfer();
  drag('dragstart', button('Project c'), data);
  drag('dragover', button('Project a'), data);
  expect(saved()).toEqual({});
  // The moving source placeholder retains the last valid insertion position.
  drag('dragover', button('Project c'), data);
  drag('drop', button('Project c'), data);
  expect(saved()).toEqual({ projects: ['c', 'a', 'b'] });
  expect(view.noop).not.toHaveBeenCalled();
  expect(projects.map((project) => project.id)).toEqual(['a', 'b', 'c']);
});

it('orders each chat group independently, keeps hidden chats, and preserves the conversation reference payload', () => {
  const view = fixture();
  for (const [source, target] of [['a5', 'a1'], ['g2', 'g1'], ['p2', 'p1']]) {
    const data = transfer();
    drag('dragstart', button(`Chat ${source}`), data);
    expect(data.effectAllowed).toBe('copyMove');
    expect(readThreadReferenceDrag(data)).toEqual({ id: source, title: `Chat ${source}` });
    drag('dragover', button(`Chat ${target}`), data);
    drag('drop', button(`Chat ${source}`), data);
    drag('dragend', button(`Chat ${source}`), data);
  }
  expect(saved()).toEqual({
    'threads:project:a': ['a5', 'a1', 'a2', 'a3', 'a4', 'a6'],
    'threads:global': ['g2', 'g1'], 'threads:pinned': ['p2', 'p1'],
  });
  expect(projectChats.every((thread) => thread.projectId === 'a')).toBe(true);
  expect(view.noop).not.toHaveBeenCalled();
});

it('rejects cross-group and external drops, and leaves order untouched after cancellation or a stale drag', () => {
  fixture();
  const data = transfer();
  drag('dragstart', button('Chat a1'), data);
  expect(drag('dragover', button('Chat b1'), data)).toBe(true);
  drag('drop', button('Chat b1'), data);
  expect(saved()).toEqual({});
  drag('dragend', button('Chat a1'), data);

  drag('dragstart', button('Chat a1'), data);
  drag('dragover', button('Chat a5'), data, 1);
  fireEvent.keyDown(window, { key: 'Escape' });
  drag('drop', button('Chat a5'), data, 1);
  expect(saved()).toEqual({});

  const external = transfer();
  external.setData('text/plain', 'a5');
  drag('drop', button('Chat a1'), external);
  expect(saved()).toEqual({});

  drag('dragstart', button('Project a'), data);
  const remote = { projects: ['c', 'b', 'a'] };
  act(() => {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(remote));
    window.dispatchEvent(new StorageEvent('storage', { key: SIDEBAR_ORDER_STORAGE_KEY }));
  });
  drag('drop', button('Project b'), data, 1);
  expect(saved()).toEqual(remote);
});

function OrderWrapper({ children }: { children: ReactNode }) {
  return <ToastProvider><SidebarOrderProvider>{children}</SidebarOrderProvider></ToastProvider>;
}

it('restores preferences and synchronizes other windows without overwriting changes to another group', () => {
  localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify({ projects: ['b', 'c', 'a'] }));
  const view = renderHook(() => useSidebarOrder('projects', projects), { wrapper: OrderWrapper });
  expect(view.result.current.items.map((project) => project.id)).toEqual(['b', 'c', 'a']);
  const remote = { projects: ['b', 'c', 'a'], 'threads:global': ['g2', 'g1'] };
  // A storage notification may not have arrived when the local drop is committed.
  localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(remote));
  act(() => view.result.current.move('a', 'b', 'before'));
  expect(saved()).toEqual({ ...remote, projects: ['a', 'b', 'c'] });
  act(() => {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(remote));
    window.dispatchEvent(new StorageEvent('storage', { key: SIDEBAR_ORDER_STORAGE_KEY }));
  });
  expect(view.result.current.items.map((project) => project.id)).toEqual(['b', 'c', 'a']);

  // The same group's newer order wins even before its storage event is delivered.
  localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify({ ...remote, projects: ['c', 'a', 'b'] }));
  act(() => view.result.current.move('a', 'b', 'before'));
  expect(view.result.current.items.map((project) => project.id)).toEqual(['c', 'a', 'b']);
});

it('retains the current order and reports a failed save through Toast', async () => {
  const view = renderHook(() => useSidebarOrder('projects', projects), { wrapper: OrderWrapper });
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  act(() => view.result.current.move('c', 'a', 'before'));
  expect(view.result.current.items.map((project) => project.id)).toEqual(['a', 'b', 'c']);
  expect(saved()).toEqual({});
  await screen.findByText('排序保存失败，请重试。');
});
