// @vitest-environment happy-dom

import type { DesktopRuntimeClient, WorkspaceEntry, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, useState, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  visibleWorkspaceFilePreview,
  workspaceFileOpenFailureFeedback,
  useProjectWorkspace,
} from '../../../../../src/features/workspace/hooks/useProjectWorkspace.js';
import { translate, type Translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { addPanelToSlotState, createFilePanel, deleteFilePanelsInSlot, renameFilePanelsInSlot, type DesktopPanelSlotState } from '../../../../../src/features/workspace/model.js';

afterEach(cleanup);

function WorkspaceProviders({ children }: PropsWithChildren) {
  return createElement(ToastProvider, null, createElement(ConfirmationProvider, null, children));
}

it('renames and moves open descendants, preserving the active draft for saving at its new path', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    renameProjectEntry: vi.fn().mockResolvedValue({ path: 'lib', name: 'lib', type: 'directory' }),
    moveProjectEntry: vi.fn().mockResolvedValue({ path: 'archive/lib', name: 'lib', type: 'directory' }),
    saveProjectFile: vi.fn().mockResolvedValue({ ...file, path: 'archive/lib/main.ts', content: 'unsaved', revision: 'revision-2' }),
  };
  const view = renderHook(() => {
    const [slot, setSlot] = useState<DesktopPanelSlotState>({
      active: 'file:src/main.ts',
      panels: [createFilePanel('src/main.ts'), createFilePanel('src/other.ts'), createFilePanel('src-extra/keep.ts')],
    });
    const workspace = useProjectWorkspace({
      activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: (path) => setSlot((current) => addPanelToSlotState(current, createFilePanel(path))),
      onEntryRenamed: (previous, next) => setSlot((current) => renameFilePanelsInSlot(current, previous, next)),
    });
    return { workspace, slot };
  }, { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.workspace.openProjectFile(file.path); });
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved'));
  await act(async () => { await view.result.current.workspace.renameEntry('src', 'lib'); });
  expect(view.result.current.workspace.filePreview?.path).toBe('lib/main.ts');
  expect(view.result.current.workspace.fileDraft).toMatchObject({ editing: true, dirty: true, content: 'unsaved' });
  expect(view.result.current.slot.active).toBe('file:lib/main.ts');
  expect(view.result.current.slot.panels.map((panel) => panel.filePath)).toEqual(['lib/main.ts', 'lib/other.ts', 'src-extra/keep.ts']);
  await act(async () => { await view.result.current.workspace.moveEntry('lib', 'archive'); });
  expect(client.moveProjectEntry).toHaveBeenCalledWith('project', 'lib', { parentPath: 'archive' });
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: 'unsaved', dirty: true });
  expect(view.result.current.slot.panels.map((panel) => panel.filePath)).toEqual(['archive/lib/main.ts', 'archive/lib/other.ts', 'src-extra/keep.ts']);
  await act(async () => { await view.result.current.workspace.fileDraft.save(); });
  expect(client.saveProjectFile).toHaveBeenCalledWith('project', 'archive/lib/main.ts', {
    content: 'unsaved', expectedRevision: 'revision-1',
  });
  expect(view.result.current.workspace.fileDraft.dirty).toBe(false);

  client.renameProjectEntry.mockRejectedValueOnce(new Error('already exists'));
  await act(async () => {
    await expect(view.result.current.workspace.renameEntry('archive/lib/main.ts', 'taken.ts')).rejects.toThrow('already exists');
  });
  expect(view.result.current.workspace.filePreview?.path).toBe('archive/lib/main.ts');
  expect(view.result.current.slot.active).toBe('file:archive/lib/main.ts');
});

it('does not apply a pending rename to the next workspace', async () => {
  let finishRename!: (entry: WorkspaceEntry) => void;
  const client = { renameProjectEntry: vi.fn().mockReturnValue(new Promise<WorkspaceEntry>((resolve) => { finishRename = resolve; })) };
  const onEntryRenamed = vi.fn();
  const view = renderHook(({ projectId }) => useProjectWorkspace({
    activeProjectId: projectId, client: client as unknown as DesktopRuntimeClient,
    onOpenFilePanel: vi.fn(), onEntryRenamed,
  }), { initialProps: { projectId: 'first' }, wrapper: WorkspaceProviders });
  let rename!: Promise<WorkspaceEntry | null>;
  act(() => { rename = view.result.current.renameEntry('old', 'new'); });
  view.rerender({ projectId: 'second' });
  await act(async () => {
    finishRename({ path: 'new', name: 'new', type: 'directory' });
    expect(await rename).toBeNull();
  });
  expect(onEntryRenamed).not.toHaveBeenCalled();
  expect(view.result.current.filePreview).toBeNull();
  expect(view.result.current.entryOperationPending).toBe(false);
});

it('blocks saves throughout a delayed move and releases the guard after either success or failure', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishMove!: (entry: WorkspaceEntry) => void;
  const movedFile = { ...file, path: 'archive/src/main.ts', content: 'unsaved', revision: 'revision-2' };
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    moveProjectEntry: vi.fn().mockReturnValueOnce(new Promise<WorkspaceEntry>((resolve) => { finishMove = resolve; })),
    saveProjectFile: vi.fn().mockResolvedValueOnce(movedFile),
  };
  const view = renderHook(() => useProjectWorkspace({
    activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  act(() => view.result.current.fileDraft.updateContent('unsaved'));
  let moving!: Promise<WorkspaceEntry | null>;
  await act(async () => {
    moving = view.result.current.moveEntry('src', 'archive');
    expect(await view.result.current.fileDraft.save()).toBe(false);
  });
  expect(client.saveProjectFile).not.toHaveBeenCalled();
  expect(view.result.current.entryOperationPending).toBe(true);
  expect(view.result.current.fileDraft).toMatchObject({ content: 'unsaved', dirty: true, saving: false });
  await act(async () => {
    finishMove({ path: 'archive/src', name: 'src', type: 'directory' });
    await moving;
  });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', movedFile.path, {
    content: 'unsaved', expectedRevision: 'revision-1',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });

  act(() => view.result.current.fileDraft.updateContent('next edit'));
  client.moveProjectEntry.mockRejectedValueOnce(new Error('move failed'));
  await act(async () => { await expect(view.result.current.moveEntry('archive/src', '')).rejects.toThrow('move failed'); });
  expect(view.result.current.entryOperationPending).toBe(false);
  client.saveProjectFile.mockResolvedValueOnce({ ...movedFile, content: 'next edit', revision: 'revision-3' });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', movedFile.path, {
    content: 'next edit', expectedRevision: 'revision-2',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });
});

it('rejects moving a saving file before React renders and lets the save complete before relocating', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishSave!: (file: WorkspaceFileRead) => void;
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    moveProjectEntry: vi.fn().mockResolvedValue({ path: 'archive/src', name: 'src', type: 'directory' }),
    saveProjectFile: vi.fn().mockReturnValueOnce(new Promise<WorkspaceFileRead>((resolve) => { finishSave = resolve; })),
  };
  const view = renderHook(() => useProjectWorkspace({
    activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  act(() => view.result.current.fileDraft.updateContent('first edit'));
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = view.result.current.fileDraft.save();
    await expect(view.result.current.moveEntry('src', 'archive')).rejects.toThrow();
  });
  expect(client.moveProjectEntry).not.toHaveBeenCalled();
  expect(view.result.current.fileDraft.saving).toBe(true);
  act(() => view.result.current.fileDraft.updateContent('second edit'));
  await act(async () => {
    finishSave({ ...file, content: 'first edit', revision: 'revision-2' });
    expect(await saving).toBe(true);
  });
  expect(view.result.current.fileDraft).toMatchObject({ content: 'second edit', dirty: true, saving: false });
  await act(async () => { await view.result.current.moveEntry('src', 'archive'); });
  client.saveProjectFile.mockResolvedValueOnce({ ...file, path: 'archive/src/main.ts', content: 'second edit', revision: 'revision-3' });
  await act(async () => { expect(await view.result.current.fileDraft.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project', 'archive/src/main.ts', {
    content: 'second edit', expectedRevision: 'revision-2',
  });
  expect(view.result.current.fileDraft).toMatchObject({ dirty: false, saving: false });
});

it('ignores background reads superseded by local editing or a different file', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'a.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishRead!: (file: WorkspaceFileRead) => void;
  const readProjectFile = vi.fn().mockResolvedValue(file);
  const view = renderHook(() => useProjectWorkspace({ activeProjectId: file.projectId,
    client: { readProjectFile } as unknown as DesktopRuntimeClient, onOpenFilePanel: vi.fn(),
  }), { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.openProjectFile(file.path); });
  readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  let refreshing!: Promise<void>;
  act(() => { refreshing = view.result.current.refreshFilePreview(() => true); });
  act(() => view.result.current.fileDraft.updateContent('local edit'));
  await act(async () => {
    finishRead({ ...file, content: 'external edit', revision: 'revision-2' });
    await refreshing;
  });
  expect(view.result.current.filePreview?.content).toBe('original');
  expect(view.result.current.fileDraft).toMatchObject({ content: 'local edit', dirty: true });

  act(() => view.result.current.fileDraft.updateContent('original'));
  readProjectFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  act(() => { refreshing = view.result.current.refreshFilePreview(() => true); });
  readProjectFile.mockResolvedValueOnce({ ...file, path: 'b.ts', content: 'another file' });
  await act(async () => { await view.result.current.openProjectFile('b.ts'); });
  await act(async () => {
    finishRead({ ...file, content: 'external edit', revision: 'revision-2' });
    await refreshing;
  });
  expect(view.result.current.filePreview?.path).toBe('b.ts');
  expect(view.result.current.fileDraft.content).toBe('another file');
});

it('retains the draft on cancelled or failed deletion and closes affected tabs only after success', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'src/main.ts', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishDeletion!: () => void;
  const pendingDeletion = new Promise<void>((resolve) => { finishDeletion = resolve; });
  const client = {
    readProjectFile: vi.fn().mockResolvedValue(file),
    deleteProjectEntry: vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockReturnValueOnce(pendingDeletion),
  };
  const view = renderHook(() => {
    const [slot, setSlot] = useState<DesktopPanelSlotState>({
      active: 'file:src/main.ts', panels: [createFilePanel('src/main.ts'), createFilePanel('src/other.ts'), createFilePanel('keep.ts')],
    });
    const workspace = useProjectWorkspace({
      activeProjectId: 'project', client: client as unknown as DesktopRuntimeClient,
      onOpenFilePanel: vi.fn(),
      onEntryDeleted: (path) => setSlot((current) => deleteFilePanelsInSlot(current, path)),
    });
    return { slot, workspace };
  }, { wrapper: WorkspaceProviders });
  await act(async () => { await view.result.current.workspace.openProjectFile(file.path); });
  act(() => view.result.current.workspace.fileDraft.updateContent('unsaved'));
  let deleting!: Promise<boolean>;
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  expect(await screen.findByText(/其中有未保存的修改/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(client.deleteProjectEntry).not.toHaveBeenCalled();
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  await act(async () => { expect(await deleting).toBe(false); });
  expect(view.result.current.workspace.fileDraft).toMatchObject({ content: 'unsaved', dirty: true });
  expect(view.result.current.slot.panels).toHaveLength(3);
  act(() => { deleting = view.result.current.workspace.deleteEntry('src'); });
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  await waitFor(() => expect(client.deleteProjectEntry).toHaveBeenCalledTimes(2));
  expect(view.result.current.workspace.entryOperationPending).toBe(true);
  await act(async () => { expect(await view.result.current.workspace.deleteEntry('src')).toBe(false); });
  expect(client.deleteProjectEntry).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishDeletion();
    expect(await deleting).toBe(true);
  });
  expect(client.deleteProjectEntry).toHaveBeenLastCalledWith('project', 'src');
  expect(view.result.current.workspace.filePreview).toBeNull();
  expect(view.result.current.workspace.fileDraft.dirty).toBe(false);
  expect(view.result.current.workspace.entryOperationPending).toBe(false);
  expect(view.result.current.slot.panels.map((panel) => panel.id)).toEqual(['file:keep.ts', 'files']);
  expect(view.result.current.slot.active).toBe('files');
});

describe('visibleWorkspaceFilePreview', () => {
  const preview: WorkspaceFileRead = {
    projectId: 'temporary_workspace.2026-07-18.thread_a',
    path: 'notes.txt',
    content: 'thread A',
    size: 8,
    truncated: false,
  };

  it('keeps a preview that belongs to the active workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, preview.projectId)).toBe(preview);
  });

  it('synchronously hides a preview from the previous workspace', () => {
    expect(visibleWorkspaceFilePreview(preview, 'temporary_workspace.2026-07-18.thread_b')).toBeNull();
    expect(visibleWorkspaceFilePreview(preview, null)).toBeNull();
  });
});

describe('workspace file open failure feedback', () => {
  const t: Translate = (key, params) => translate('zh-CN', key, params);

  it('warns when a referenced file no longer exists', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/deleted.ts',
      new Error("ENOENT: no such file or directory, stat '/workspace/src/deleted.ts'"),
      t,
    )).toEqual({
      message: '无法打开 src/deleted.ts：文件已删除或不存在。',
      tone: 'warning',
    });
  });

  it('keeps unrelated read failures as errors', () => {
    expect(workspaceFileOpenFailureFeedback(
      'src/private.ts',
      new Error('Permission denied'),
      t,
    )).toEqual({
      message: '无法打开 src/private.ts：Permission denied',
      tone: 'error',
    });
  });
});
