// @vitest-environment happy-dom

import type { DesktopRuntimeClient, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../../../src/composition/review-feature-adapter.js';
import { useDesktopWorkspacePanels } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { useProjectWorkspace } from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { useWorkspaceFilePanelLifecycle } from '../../../../../src/features/workspace/hooks/useWorkspaceFilePanelLifecycle.js';
import type { DesktopPanelSlot } from '../../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

const project = { id: 'project', name: 'Project', path: '/repo', createdAt: '', updatedAt: '' };
function file(path: string): WorkspaceFileRead {
  return { projectId: project.id, path, content: `contents of ${path}`, size: 20,
    revision: path, preview: { kind: 'text' }, truncated: false };
}

function Providers({ children }: PropsWithChildren) {
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><ConfirmationProvider>
    <ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary>
  </ConfirmationProvider></ToastProvider></I18nProvider>;
}

function setup() {
  const readProjectFile = vi.fn(async (_projectId: string, path: string) => file(path));
  const client = { readProjectFile } as unknown as DesktopRuntimeClient;
  const view = renderHook(() => {
    const panels = useDesktopWorkspacePanels({ activeProject: project, activeView: 'chat', conversationDebugEnabled: false,
      targetIdentity: 'new-thread-slot:project', workspaceStatus: 'ready', setError: vi.fn() });
    const workspace = useProjectWorkspace({ activeProjectId: project.id, client, onOpenFilePanel: panels.openFilePanel });
    const closeActions = useWorkspaceFilePanelLifecycle({ panels, workspace, projectId: project.id,
      targetIdentity: 'new-thread-slot:project' });
    return { panels: { ...panels, ...closeActions }, workspace };
  }, { wrapper: Providers });
  const openFiles = async (slot: DesktopPanelSlot) => {
    act(() => view.result.current.panels.openDesktopPanel(slot, 'files'));
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      await act(async () => { await view.result.current.workspace.openProjectFile(path); });
    }
  };
  return { ...view, readProjectFile, openFiles };
}

it.each(['side', 'bottom'] as const)('keeps each remaining %s tab bound to its own document when closing tabs', async (slot) => {
  const view = setup();
  await view.openFiles(slot);
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  const closeActive = () => slot === 'side' ? view.result.current.panels.closeActiveSidePanel()
    : view.result.current.panels.closeDesktopPanelItem(slot, view.result.current.panels[slotKey].active!);

  for (const nextPath of ['b.ts', 'a.ts']) {
    await act(async () => { await closeActive(); });
    await waitFor(() => expect(view.result.current.workspace.filePreview?.path).toBe(nextPath));
    expect(view.result.current.panels[slotKey].active).toBe(`file:${nextPath}`);
    expect(view.result.current.workspace.fileDraft.content).toBe(file(nextPath).content);
  }
  await act(async () => { await closeActive(); });
  expect(view.result.current.panels[slotKey].panels.map((panel) => panel.id)).toEqual(['files']);
  expect(view.result.current.workspace.filePreview).toBeNull();
});

it('does not reopen an intermediate tab when its read completes after another close', async () => {
  const view = setup();
  await view.openFiles('side');
  let finishRead!: (file: WorkspaceFileRead) => void;
  view.readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  await act(async () => { await view.result.current.panels.closeActiveSidePanel(); });
  expect(view.result.current.panels.sideActivePanel?.filePath).toBe('b.ts');
  expect(view.readProjectFile).toHaveBeenLastCalledWith(project.id, 'b.ts');
  await act(async () => { await view.result.current.panels.closeActiveSidePanel(); });
  await waitFor(() => expect(view.result.current.workspace.filePreview?.path).toBe('a.ts'));
  await act(async () => { finishRead(file('b.ts')); });
  expect(view.result.current.workspace.fileDraft.content).toBe(file('a.ts').content);
  expect(view.result.current.panels.sidePanelSlot.panels.map((panel) => panel.id)).toEqual(['files', 'file:a.ts']);

  await act(async () => { await view.result.current.workspace.openProjectFile('b.ts'); });
  view.readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  await act(async () => { await view.result.current.panels.closeActiveSidePanel(); });
  await act(async () => { await view.result.current.panels.closeActiveSidePanel(); });
  await act(async () => { finishRead(file('a.ts')); });
  expect(view.result.current.panels.sideActivePanel?.type).toBe('files');
  expect(view.result.current.workspace.filePreview).toBeNull();
});

it.each(['side', 'bottom'] as const)('retains a dirty %s document when close is cancelled and clears it only after confirmation', async (slot) => {
  const view = setup();
  await view.openFiles(slot);
  const slotKey = slot === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved c'));
  await act(async () => { await view.result.current.panels.closeDesktopPanelItem(slot, 'file:a.ts'); });
  expect(view.result.current.workspace.fileDraft.content).toBe('unsaved c');
  expect(screen.queryByRole('dialog')).toBeNull();

  let closing!: Promise<void>;
  act(() => { closing = view.result.current.panels.closeDesktopPanelItem(slot, 'file:c.ts'); });
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await act(async () => { await closing; });
  expect(view.result.current.panels[slotKey].active).toBe('file:c.ts');
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: 'unsaved c', dirty: true });

  act(() => { closing = view.result.current.panels.closeDesktopPanelItem(slot, 'file:c.ts'); });
  fireEvent.click(await screen.findByRole('button', { name: '确认' }));
  await act(async () => { await closing; });
  await waitFor(() => expect(view.result.current.workspace.filePreview?.path).toBe('b.ts'));
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: file('b.ts').content, dirty: false });
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved b'));
  act(() => { closing = view.result.current.panels.closeDesktopPanelSlot(slot); });
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await act(async () => { await closing; });
  expect(view.result.current.panels[slotKey].active).toBe('file:b.ts');
  expect(view.result.current.workspace.fileDraft.content).toBe('unsaved b');
});
