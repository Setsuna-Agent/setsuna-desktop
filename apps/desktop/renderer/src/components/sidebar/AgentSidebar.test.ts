import { createElement, createRef, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { AgentSidebar } from './AgentSidebar.js';

vi.mock('./SidebarFloatingMenu.js', () => ({
  SidebarFloatingMenu: ({ children }: { children: ReactNode }) => children,
}));

describe('AgentSidebar project actions', () => {
  it('keeps project thread creation on the row and project archiving in the overflow menu', () => {
    const html = renderToStaticMarkup(createElement(AgentSidebar, {
      activeProjectId: project.id,
      activeThreadId: null,
      activeView: 'chat',
      collapsedProjectIds: new Set<string>(),
      forceExpandedProjectIds: new Set<string>(),
      globalThreads: [],
      maxWidth: 420,
      minWidth: 180,
      projectActionMenuId: project.id,
      projects: [project],
      projectsCollapsed: false,
      searchOpen: false,
      searchTriggerRef: createRef<HTMLButtonElement>(),
      selectingProjectDirectory: false,
      sessionsCollapsed: false,
      threadActionMenuId: null,
      threadsByProjectId: new Map(),
      width: 240,
      onArchiveProject: () => undefined,
      onArchiveThread: () => undefined,
      onCreateCurrentThread: () => undefined,
      onCreateGlobalThread: () => undefined,
      onCreateProjectThread: () => undefined,
      onEnterChatMode: () => undefined,
      onOpenCapabilities: () => undefined,
      onOpenSettings: () => undefined,
      onRemoveProject: () => undefined,
      onRenameThread: () => undefined,
      onResizeStart: () => undefined,
      onResizeStep: () => undefined,
      onSelectDirectory: () => undefined,
      onSelectProject: () => undefined,
      onSelectThread: () => undefined,
      onToggleProjectActions: () => undefined,
      onToggleProjectsCollapsed: () => undefined,
      onToggleSearch: () => undefined,
      onToggleSessionsCollapsed: () => undefined,
      onToggleThreadActions: () => undefined,
    }));

    expect(html).toContain('aria-label="在 test-project 中新建会话"');
    expect(html).toContain('归档项目');
    expect(html.match(/>新对话</g)).toHaveLength(1);
  });
});

const project: WorkspaceProject = {
  id: 'project_test',
  name: 'test-project',
  path: '/workspace/test-project',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};
