// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopGitHistoryPage } from '@setsuna-desktop/feature-review/contracts';
import type { WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { appReadySlot, shellRouteSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/app/providers/ToastProvider.js';
import { activateBuiltinRendererFeatures } from '../../../src/composition/renderer-feature-composition.js';
import { ReviewFeatureHostBoundary } from '../../../src/composition/review-feature-adapter.js';
import { useDesktopPanelResize } from '../../../src/features/workspace/hooks/useDesktopPanelResize.js';
import { createChangesPanel, createFilePanel, createFilesPanel } from '../../../src/features/workspace/model.js';
import { useWorkspaceFileTree } from '../../../src/features/workspace/hooks/useWorkspaceFileTree.js';
import { WorkspacePanel } from '../../../src/features/workspace/WorkspacePanel.js';
import {
  RendererKernelProvider,
  RendererOwnedKeyedSlot,
  RendererRootSingleSlot,
} from '../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { I18nProvider, useI18n } from '../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it('mounts Changes through the built-in shell and chat slots, including working resize controls', async () => {
  const oid = 'a'.repeat(40);
  const history: DesktopGitHistoryPage = {
    gitRoot: '/repo', head: oid, tip: oid, currentBranch: 'main', nextSkip: null,
    refs: [{ name: 'refs/heads/main', label: 'main', kind: 'local', oid }],
    commits: [{ oid, parents: [], subject: 'Initial project', author: 'Author', authoredAt: '2026-09-09T10:00:00Z' }],
  };
  const getHistory = vi.fn().mockResolvedValue(history);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      desktopReview: { getHistory },
      links: { openExternal: vi.fn() },
      runtime: {
        request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }),
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920);
  const features = await activateBuiltinRendererFeatures();
  try {
    const view = renderWorkspace(features, <ChangesWorkspace />);

    expect(await screen.findByRole('navigation', { name: '变更' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Initial project/ })).toBeTruthy();
    expect(getHistory).toHaveBeenCalledWith('/repo', { ref: undefined });
    const handle = screen.getByRole('separator', { name: '调整右侧面板宽度' });
    const shell = view.container.querySelector<HTMLElement>('.app-shell')!;
    expect(handle.getAttribute('aria-valuenow')).toBe('640');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 1100 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 1100 });
    expect(handle.getAttribute('aria-valuenow')).toBe('740');
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('740px');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('724');
    expect(shell.style.getPropertyValue('--desktop-agent-workspace-width')).toBe('724px');
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

function renderWorkspace(features: Awaited<ReturnType<typeof activateBuiltinRendererFeatures>>, workspace: ReactNode) {
  return render(
    <I18nProvider initialLocale="zh-CN" messageCatalog={features.messages}>
      <ToastProvider>
        <ReviewFeatureHostBoundary>
          <RendererKernelProvider runtime={features.rendererPlugins}>
            <RendererRootSingleSlot slot={appReadySlot} props={{
              renderDefault: () => <RendererOwnedKeyedSlot slot={shellRouteSlot} entryKey="chat" props={{
                routeId: 'chat' as const, renderDefault: () => workspace,
              }} />,
            }} />
          </RendererKernelProvider>
        </ReviewFeatureHostBoundary>
      </ToastProvider>
    </I18nProvider>,
  );
}

it('shares the directory navigator across file and files renderer slots', async () => {
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      runtime: {
        request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }),
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  const searchEntries = vi.fn(async (query = '', parent?: string | null): Promise<WorkspaceEntrySearchResponse> => ({
    entries: query ? [{ kind: 'file', name: 'b.ts', path: 'src/b.ts', parent: 'src' }]
      : parent === 'src' ? [
        { kind: 'file', name: 'a.ts', path: 'src/a.ts', parent: 'src' },
        { kind: 'file', name: 'b.ts', path: 'src/b.ts', parent: 'src' },
      ] : [{ kind: 'directory', name: 'src', path: 'src', parent: '' }],
    query, scanned: 3, truncated: false, workspaceRoot: '/repo',
  }));
  const features = await activateBuiltinRendererFeatures();
  try {
    const view = renderWorkspace(features, <FilesWorkspace searchEntries={searchEntries} />);
    fireEvent.click(await screen.findByRole('button', { name: 'src' }));
    await screen.findByRole('button', { name: 'a.ts' });
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整文件目录宽度' }), { key: 'ArrowLeft' });
    const list = view.container.querySelector<HTMLElement>('.desktop-file-list')!;
    list.scrollTop = 128;
    fireEvent.scroll(list);

    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }));
    expect(screen.getByRole('button', { name: 'b.ts' })).toBeTruthy();
    expect(view.container.querySelector('.desktop-file-list')?.scrollTop).toBe(128);
    expect(screen.getByRole('separator', { name: '调整文件目录宽度' }).getAttribute('aria-valuenow')).toBe('232');
    fireEvent.click(screen.getByRole('button', { name: 'b.ts' }));
    fireEvent.click(screen.getByRole('button', { name: '目录标签' }));
    expect(screen.getByRole('button', { name: 'a.ts' })).toBeTruthy();
    expect(searchEntries).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByPlaceholderText('筛选文件...'), { target: { value: 'b' } });
    await screen.findByRole('button', { name: 'b.ts' });
    fireEvent.click(screen.getByRole('button', { name: 'b.ts' }));
    expect((screen.getByPlaceholderText('筛选文件...') as HTMLInputElement).value).toBe('b');
    fireEvent.click(screen.getByRole('button', { name: '收起文件目录' }));
    fireEvent.click(screen.getByRole('button', { name: '目录标签' }));
    expect(screen.getByRole('button', { name: '展开文件目录' })).toBeTruthy();
    expect(searchEntries).toHaveBeenCalledTimes(3);
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

it('creates, renames and deletes entries from the tree menu, preserving state when operations fail', async () => {
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      desktop: { platform: 'darwin' },
      runtime: {
        request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }),
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  const searchEntries = vi.fn(async (): Promise<WorkspaceEntrySearchResponse> => ({
    entries: [], query: '', scanned: 0, truncated: false, workspaceRoot: '/repo',
  }));
  const onCreateEntry = vi.fn()
    .mockResolvedValueOnce({ path: 'assets', name: 'assets', type: 'directory' })
    .mockRejectedValueOnce(new Error('already exists'))
    .mockResolvedValueOnce({ path: 'assets/widget.vue', name: 'widget.vue', type: 'file' });
  const onRenameEntry = vi.fn()
    .mockResolvedValueOnce({ path: 'assets/renamed.vue', name: 'renamed.vue', type: 'file' })
    .mockResolvedValueOnce({ path: 'widgets', name: 'widgets', type: 'directory' });
  const onDeleteEntry = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const features = await activateBuiltinRendererFeatures();
  try {
    const view = renderWorkspace(features, <FilesWorkspace searchEntries={searchEntries}
      onCreateEntry={onCreateEntry} onRenameEntry={onRenameEntry} onDeleteEntry={onDeleteEntry} />);
    await waitFor(() => expect(screen.queryByText('正在搜索...')).toBeNull());
    fireEvent.contextMenu(view.container.querySelector('.desktop-file-list')!);
    expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建文件夹' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'assets' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'assets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '新建文件' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'existing.vue' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect((await screen.findByRole('alert')).textContent).toBe('already exists');
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('existing.vue');
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'widget.vue' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'widget.vue' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('widget.vue');
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'renamed.vue' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await screen.findByRole('button', { name: 'renamed.vue' });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'assets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'widgets' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await screen.findByRole('button', { name: 'widgets' });
    expect(screen.getByRole('button', { name: 'renamed.vue' }).getAttribute('title')).toBe('widgets/renamed.vue');
    expect(onCreateEntry).toHaveBeenLastCalledWith({ parentPath: 'assets', name: 'widget.vue', type: 'file' });
    expect(onRenameEntry.mock.calls).toEqual([['assets/widget.vue', 'renamed.vue'], ['assets', 'widgets']]);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'renamed.vue' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    await waitFor(() => expect(onDeleteEntry).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'renamed.vue' })).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'renamed.vue' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'renamed.vue' })).toBeNull());
    fireEvent.contextMenu(screen.getByRole('button', { name: 'widgets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'widgets' })).toBeNull());
    expect(onDeleteEntry.mock.calls).toEqual([['widgets/renamed.vue'], ['widgets/renamed.vue'], ['widgets']]);
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

it('moves files into and out of folders and preserves nested entries when dragging a folder', async () => {
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { desktop: { platform: 'darwin' }, runtime: {
      request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }), startSse: vi.fn(() => vi.fn()),
    } },
  });
  const searchEntries = vi.fn(async (_query = '', parent = ''): Promise<WorkspaceEntrySearchResponse> => {
    const paths = parent === 'src' ? ['src/nested'] : parent === 'src/nested' ? ['src/nested/keep.ts']
      : parent === 'archive' ? ['archive/draft.ts'] : ['src', 'archive', 'draft.ts'];
    return {
      entries: paths.map((path) => ({ kind: path.endsWith('.ts') ? 'file' : 'directory', path,
        name: path.split('/').pop()!, parent })),
      query: '', scanned: paths.length, truncated: false, workspaceRoot: '/repo',
    };
  });
  const onMoveEntry = vi.fn()
    .mockResolvedValueOnce({ path: 'archive/draft.ts', name: 'draft.ts', type: 'file' })
    .mockResolvedValueOnce({ path: 'draft.ts', name: 'draft.ts', type: 'file' })
    .mockResolvedValueOnce({ path: 'archive/nested', name: 'nested', type: 'directory' })
    .mockRejectedValueOnce(new Error('already exists'));
  const features = await activateBuiltinRendererFeatures();
  try {
    const view = renderWorkspace(features, <FilesWorkspace searchEntries={searchEntries} onMoveEntry={onMoveEntry} />);
    fireEvent.click(await screen.findByRole('button', { name: 'src' }));
    fireEvent.click(await screen.findByRole('button', { name: 'nested' }));
    await screen.findByRole('button', { name: 'keep.ts' });
    dragEntry(screen.getByRole('button', { name: 'draft.ts' }), screen.getByRole('button', { name: 'archive' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'draft.ts' }).getAttribute('title')).toBe('archive/draft.ts'));
    const fileList = view.container.querySelector('.desktop-file-list')!;
    dragEntry(screen.getByRole('button', { name: 'draft.ts' }), fileList, () => {
      expect(fileList.classList.contains('is-drop-target')).toBe(true);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'draft.ts' }).getAttribute('title')).toBe('draft.ts'));
    dragEntry(screen.getByRole('button', { name: 'nested' }), screen.getByRole('button', { name: 'archive' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'keep.ts' }).getAttribute('title')).toBe('archive/nested/keep.ts'));
    dragEntry(screen.getByRole('button', { name: 'archive' }), screen.getByRole('button', { name: 'nested' }));
    expect(await screen.findByText('不能将文件夹移入自身或它的子文件夹。')).toBeTruthy();
    expect(onMoveEntry).toHaveBeenCalledTimes(3);
    dragEntry(screen.getByRole('button', { name: 'draft.ts' }), screen.getByRole('button', { name: 'archive' }), () => {
      const target = view.container.querySelector('.is-drop-target');
      expect(target).toBe(screen.getByRole('button', { name: 'archive' }).closest('.desktop-file-tree-node'));
      expect(target?.contains(screen.getByRole('button', { name: 'keep.ts' }))).toBe(true);
      expect(fileList.classList.contains('is-drop-target')).toBe(false);
    });
    expect(await screen.findByText('移动失败：already exists')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'draft.ts' }).getAttribute('title')).toBe('draft.ts');
    expect(onMoveEntry.mock.calls).toEqual([
      ['draft.ts', 'archive'], ['archive/draft.ts', ''], ['src/nested', 'archive'], ['draft.ts', 'archive'],
    ]);
  } finally {
    cleanup();
    await features.composition.dispose();
  }
});

function dragEntry(source: Element, target: Element, afterDragOver?: () => void) {
  const values = new Map<string, string>();
  const dataTransfer = {
    types: [] as string[], effectAllowed: 'none', dropEffect: 'none',
    setData(type: string, value: string) { this.types.push(type); values.set(type, value); },
    getData(type: string) { return values.get(type) ?? ''; },
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  afterDragOver?.();
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

function FilesWorkspace({
  searchEntries,
  onCreateEntry = panelProps.onCreateEntry,
  onRenameEntry = panelProps.onRenameEntry,
  onMoveEntry = panelProps.onMoveEntry,
  onDeleteEntry = panelProps.onDeleteEntry,
}: {
  searchEntries: Parameters<typeof useWorkspaceFileTree>[0]['searchEntries'];
  onCreateEntry?: ComponentProps<typeof WorkspacePanel>['onCreateEntry'];
  onRenameEntry?: ComponentProps<typeof WorkspacePanel>['onRenameEntry'];
  onMoveEntry?: ComponentProps<typeof WorkspacePanel>['onMoveEntry'];
  onDeleteEntry?: ComponentProps<typeof WorkspacePanel>['onDeleteEntry'];
}) {
  const [activePanel, setActivePanel] = useState(createFilesPanel);
  const fileTree = useWorkspaceFileTree({ workspaceKey: 'project_1', enabled: true, searchEntries });
  const { t } = useI18n();
  return <>
    <button onClick={() => setActivePanel(createFilesPanel())}>目录标签</button>
    <RendererOwnedKeyedSlot slot={workspacePanelSlot} entryKey={activePanel.type} instanceKey={activePanel.id} props={{
      panelId: activePanel.id, panelType: activePanel.type, placement: 'side', projectId: 'project_1',
      surfaceInstanceId: activePanel.id, threadId: 'thread_1', translate: t, visible: true,
      renderDefault: () => <WorkspacePanel
        {...panelProps} activePanel={activePanel} fileTree={fileTree}
        onCreateEntry={onCreateEntry} onRenameEntry={onRenameEntry} onMoveEntry={onMoveEntry} onDeleteEntry={onDeleteEntry}
        onOpenProjectFile={(filePath) => setActivePanel(createFilePanel(filePath))}
        onOpenEntry={(entry) => setActivePanel(createFilePanel(entry.path))}
        onResizeStart={noop} onResizeStep={noop} resizeMin={320} resizeMax={900} resizeValue={640}
      />,
    }} />
  </>;
}

function ChangesWorkspace() {
  const shellRef = useRef<HTMLDivElement>(null);
  const resize = useDesktopPanelResize(shellRef);
  const { t } = useI18n();
  const fileTree = useWorkspaceFileTree({ workspaceKey: 'project_1', enabled: false, searchEntries: vi.fn() });
  return (
    <div className="app-shell" ref={shellRef}>
      <RendererOwnedKeyedSlot slot={workspacePanelSlot} entryKey="changes" instanceKey="workspace:side:changes" props={{
        panelId: 'changes', panelType: 'changes', placement: 'side', projectId: 'project_1',
        surfaceInstanceId: 'workspace:side:changes', threadId: 'thread_1', translate: t, visible: true,
        renderDefault: () => <WorkspacePanel
          {...panelProps}
          fileTree={fileTree}
          onResizeStart={resize.handleWorkspaceResizeStart}
          onResizeStep={resize.handleWorkspaceResizeStep}
          resizeMin={resize.workspaceMinWidth}
          resizeMax={resize.workspaceMaxWidth}
          resizeValue={resize.workspaceWidth}
        />,
      }} />
    </div>
  );
}

const noop = () => undefined;
const panelProps = {
  activePanel: createChangesPanel(),
  activeProject: { id: 'project_1', name: 'Fixture', path: '/repo', createdAt: '', updatedAt: '' },
  entryOperationPending: false,
  fileDraft: {
    canEdit: false, confirmDiscardChanges: async () => true, content: '',
    dirty: false, editing: false, error: null, errorMessage: null, preparing: false,
    save: async () => false, saving: false, isSaving: () => false, updateContent: noop, relocateFile: noop,
  },
  fileFocusRequest: null, filePreview: null, latestReviewSummary: null, latestReviewFindings: [],
  reviewError: null, reviewFocusRequest: null, reviewLoading: false, reviewState: null,
  selectedWorkspaceApp: null, workspaceApps: [],
  onAddFileToConversation: noop, onCopyFilePath: noop, onExternalOpenFile: noop, onOpenFileWithApp: noop,
  onCreateEntry: async () => null, onRenameEntry: async () => null,
  onMoveEntry: async () => null,
  onDeleteEntry: async () => false,
  onOpenEntry: noop, onOpenProjectFile: noop, onOpenFilesPanel: noop,
  onOpenBrowser: noop, onOpenSideChat: noop, onOpenTerminalPanel: noop, onReviewRefresh: noop,
  onReviewBaseRefChange: noop, onReviewSourceChange: noop, onRevealFile: noop,
} satisfies Omit<ComponentProps<typeof WorkspacePanel>, 'fileTree' | 'onResizeStart' | 'onResizeStep' | 'resizeMin' | 'resizeMax' | 'resizeValue'>;
