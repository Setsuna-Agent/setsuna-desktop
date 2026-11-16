// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest, type RuntimePluginSummary, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { appReadySlot, shellOverlaySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/app/providers/ToastProvider.js';
import { useDesktopNavigation } from '../../../src/app/controller/useDesktopNavigation.js';
import { AppOverlays } from '../../../src/app/layout/AppOverlays.js';
import type { SidebarSearchActionHandlers } from '../../../src/app/sidebar/useSidebarSearchActions.js';
import { PluginManagementFeatureServiceBoundary } from '../../../src/composition/PluginManagementFeatureBoundary.js';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';
import {
  RendererKernelProvider,
  RendererOwnedSingleSlot,
  RendererRootSingleSlot,
} from '../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createDesktopRuntimeClient } from '../../../src/services/runtime-client/client.js';
import { I18nProvider } from '../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it('opens search through the built-in shell and navigates to settings and installed apps', async () => {
  const plugin: RuntimePluginSummary = {
    id: 'notes', name: 'Notes', installedAt: '2026-11-16T00:00:00Z',
    skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
    extension: {
      apiVersion: 1, runtime: 'node-worker', capabilities: ['ui'], trust: 'trusted',
      rendererUi: parseRuntimePluginUiManifest({
        schemaVersion: 2, actions: [], contributions: [{
          id: 'page', slot: 'renderer.plugin.page', navigation: { label: '项目笔记' },
          tree: { type: 'text', text: 'Notes' },
        }],
      }),
    },
  };
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      runtime: {
        request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [plugin] } }),
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  const actions: SidebarSearchActionHandlers = {
    onNewChat: vi.fn(), onAddProject: vi.fn(), onOpenChat: vi.fn(), onOpenAutomation: vi.fn(),
    onOpenCapabilities: vi.fn(), onOpenPullRequests: vi.fn(), onOpenPlugin: vi.fn(), onOpenSettings: vi.fn(),
  };
  const features = await activateBuiltinRendererFeatures();
  try {
    renderSearch(features, { actions });

    fireEvent.click(screen.getByRole('button', { name: '打开搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shortcuts' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(actions.onOpenSettings).toHaveBeenCalledWith('shortcuts'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '打开搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '笔记' } });
    fireEvent.click(await screen.findByRole('option', { name: '项目笔记' }));
    await waitFor(() => expect(actions.onOpenPlugin).toHaveBeenCalledWith('notes/page'));
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

it('opens text search for the current project and preserves the target line when opening a result', async () => {
  const request = vi.fn(async ({ path }: { path: string }) => {
    if (path === '/v1/features/plugin-management/installed') return { ok: true, value: { plugins: [] } };
    if (path === '/v1/projects/current/search?q=needle&rootId=primary') return {
      results: [{ path: 'src/note.ts', line: 12, preview: 'const needle = 1;' }],
      query: 'needle', truncated: false,
    };
    throw new Error(`Unexpected request: ${path}`);
  });
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { desktop: { platform: 'darwin' }, runtime: { request, startSse: vi.fn(() => vi.fn()) } },
  });
  const onOpenSearchFile = vi.fn(async () => undefined);
  const projects = ['other', 'current'].map((id) => ({ id, name: id, path: `/${id}`, createdAt: '', updatedAt: '' }));
  const features = await activateBuiltinRendererFeatures();
  try {
    renderSearch(features, { activeProjectId: 'current', projects, onOpenSearchFile });
    const trigger = screen.getByRole('button', { name: '搜索文本' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox', { name: '搜索 Setsuna' }), { target: { value: 'needle' } });
    fireEvent.click(await screen.findByRole('option', { name: /note.ts/ }));
    await waitFor(() => expect(onOpenSearchFile).toHaveBeenCalledExactlyOnceWith({
      projectId: 'current', rootId: 'primary', path: 'src/note.ts', line: 12,
    }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(screen.getByRole('button', { name: '打开搜索' }));
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('combobox', { name: '搜索项目' })).toBeNull();
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

const noop = () => undefined;
const defaultActions: SidebarSearchActionHandlers = {
  onNewChat: noop, onAddProject: noop, onOpenChat: noop, onOpenAutomation: noop,
  onOpenCapabilities: noop, onOpenPullRequests: noop, onOpenPlugin: noop, onOpenSettings: noop,
};

function renderSearch(features: Awaited<ReturnType<typeof activateBuiltinRendererFeatures>>, props: ComponentProps<typeof SearchHost>) {
  return render(
    <I18nProvider initialLocale="zh-CN" messageCatalog={features.messages}>
      <ToastProvider>
        <PluginManagementFeatureServiceBoundary service={features.services.pluginManagement}>
          <RendererKernelProvider runtime={features.rendererPlugins}>
            <RendererRootSingleSlot slot={appReadySlot} props={{ renderDefault: () => <SearchHost {...props} /> }} />
          </RendererKernelProvider>
        </PluginManagementFeatureServiceBoundary>
      </ToastProvider>
    </I18nProvider>,
  );
}

function SearchHost({ actions = defaultActions, activeProjectId = null, projects = [], onOpenSearchFile = async () => undefined }: {
  actions?: SidebarSearchActionHandlers;
  activeProjectId?: string | null;
  projects?: WorkspaceProject[];
  onOpenSearchFile?: ComponentProps<typeof AppOverlays>['onOpenSearchFile'];
}) {
  const [client] = useState(createDesktopRuntimeClient);
  const runtimeActivityTriggerRef = useRef<HTMLButtonElement>(null);
  const navigation = useDesktopNavigation({
    activeProjectId, activeView: 'chat', currentThread: null, client, projects,
    confirmDiscardProjectFile: async () => true, onError: noop, reloadThreads: async () => [],
    resetNewThreadWorkspacePanels: noop, resetProjectWorkspaceState: noop, resetThreadWorkspacePanels: noop,
    setActiveProjectId: noop, setActiveView: noop, setCurrentThread: noop, setProjects: noop, threadsByProjectId: new Map(),
  });
  return <>
    <button onClick={() => navigation.openSidebarSearch()}>打开搜索</button>
    <button onClick={() => navigation.openSidebarSearch('text')}>搜索文本</button>
    <RendererOwnedSingleSlot slot={shellOverlaySlot} props={{
      renderDefault: () => <AppOverlays
        searchActions={actions} client={client} projects={projects} threads={[]} navigation={navigation}
        onOpenSearchFile={onOpenSearchFile} onOpenThread={noop} onActivitiesChanged={noop}
        runtimeActivityOpen={false} runtimeActivityTriggerRef={runtimeActivityTriggerRef} onCloseRuntimeActivity={noop}
      />,
    }} />
  </>;
}
