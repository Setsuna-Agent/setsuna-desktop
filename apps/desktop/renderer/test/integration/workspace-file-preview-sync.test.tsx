// @vitest-environment happy-dom

import type { DesktopRuntimeClient, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../src/composition/review-feature-adapter.js';
import { useDesktopWorkspacePanels } from '../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { useProjectWorkspace } from '../../src/features/workspace/hooks/useProjectWorkspace.js';
import { useWorkspaceFilePanelLifecycle } from '../../src/features/workspace/hooks/useWorkspaceFilePanelLifecycle.js';
import { I18nProvider } from '../../src/shared/i18n/I18nProvider.js';

it('refreshes an open document after external writes, without overwriting a dirty draft or using an old save revision', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-preview-sync-'));
  await mkdir(path.join(root, 'src'));
  const filePath = 'src/README.md';
  const diskPath = path.join(root, filePath);
  await writeFile(diskPath, '# Original');
  const project = { id: 'project', name: 'Project', path: root, createdAt: '', updatedAt: '' };
  const read = async (): Promise<WorkspaceFileRead> => {
    const content = await readFile(diskPath, 'utf8');
    return { projectId: project.id, path: filePath, content, size: Buffer.byteLength(content),
      revision: createHash('sha256').update(content).digest('hex'), preview: { kind: 'text' }, truncated: false };
  };
  const saveProjectFile = vi.fn(async (_projectId: string, _path: string, input: { content: string; expectedRevision: string }) => {
    expect(input.expectedRevision).toBe((await read()).revision);
    await writeFile(diskPath, input.content);
    return read();
  });
  const client = { readProjectFile: vi.fn(read), saveProjectFile } as unknown as DesktopRuntimeClient;
  const listeners = new Set<() => void>();
  // Main tests exercise OS events; this renderer fixture supplies the corresponding preload notifications.
  const watchEntries = vi.fn((_workspaceRoot: string, _directories: string[], changed: () => void) => {
    listeners.add(changed);
    queueMicrotask(() => { if (listeners.has(changed)) changed(); });
    return () => { listeners.delete(changed); };
  });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true,
    value: { desktop: { platform: 'darwin', watchWorkspaceEntries: watchEntries },
      workspaceApps: { list: vi.fn().mockResolvedValue([]) } } });
  const view = renderHook(() => {
    const panels = useDesktopWorkspacePanels({ activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
      targetIdentity: 'new-thread-slot:project', workspaceStatus: 'ready', setError: vi.fn() });
    const workspace = useProjectWorkspace({ activeProjectId: project.id, client, onOpenFilePanel: panels.openFilePanel });
    useWorkspaceFilePanelLifecycle({ panels, workspace, projectId: project.id, workspaceRoot: root,
      targetIdentity: 'new-thread-slot:project' });
    return { panels, workspace };
  }, { wrapper: ({ children }) => <I18nProvider initialLocale="zh-CN"><ToastProvider><ConfirmationProvider>
    <ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary>
  </ConfirmationProvider></ToastProvider></I18nProvider> });
  try {
    await act(async () => { await view.result.current.workspace.openProjectFile(filePath); });
    await waitFor(() => expect(watchEntries).toHaveBeenCalledWith(root, ['src'], expect.any(Function)));
    await writeFile(diskPath, '# Updated by a tool');
    act(() => listeners.forEach((changed) => changed()));
    await waitFor(() => expect(view.result.current.workspace.fileDraft.content).toBe('# Updated by a tool'));
    expect(view.result.current.workspace.filePreview?.content).toBe('# Updated by a tool');
    expect(view.result.current.panels.sidePanelSlot.panels.map((panel) => panel.filePath)).toEqual([filePath]);

    act(() => view.result.current.workspace.fileDraft.updateContent('# Saved locally'));
    await act(async () => { expect(await view.result.current.workspace.fileDraft.save()).toBe(true); });
    expect(saveProjectFile).toHaveBeenCalledTimes(1);
    act(() => view.result.current.workspace.fileDraft.updateContent('# Unsaved local draft'));
    await writeFile(diskPath, '# Another external change');
    act(() => listeners.forEach((changed) => changed()));
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(view.result.current.workspace.fileDraft).toMatchObject({ content: '# Unsaved local draft', dirty: true });

    act(() => view.result.current.workspace.fileDraft.updateContent('# Saved locally'));
    await waitFor(() => expect(view.result.current.workspace.fileDraft.content).toBe('# Another external change'));
    expect(view.result.current.workspace.fileDraft.dirty).toBe(false);
  } finally {
    view.unmount();
    expect(listeners.size).toBe(0);
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
    await rm(root, { recursive: true, force: true });
  }
});
