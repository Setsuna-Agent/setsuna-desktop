import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import { runtimeActivityRendererFeature } from '@setsuna-desktop/feature-runtime-activity/renderer';
import { createElement, createRef, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar } from '../../../../src/app/sidebar/AgentSidebar.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: runtimeActivityRendererFeature }]);

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
    const noop = () => undefined;
    const sidebar = createElement(AgentSidebar, {
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
      runtimeActivityTriggerRef: createRef<HTMLButtonElement>(),
    });
    const html = renderToStaticMarkup(createElement(
      I18nProvider,
      { initialLocale: 'zh-CN', messageCatalog },
      sidebar,
    ));

    expect(html).toContain('aria-label="新建项目"');
    expect(html).toContain('class="desktop-agent-project is-menu-open"');
    expect(html).toContain('aria-label="在 test-project 中新建会话"');
    expect(html).toContain('>编辑项目</button>');
    expect(html).toContain('>归档项目</button>');
    expect(html).toContain('>插件</span>');
    expect(html).toContain('aria-label="更多操作"');
    expect(html).toContain('>运行中心</button>');
  });
});
