// @vitest-environment happy-dom

import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canEditWorkspaceFile,
  useWorkspaceFileDraft,
} from '../../../../../src/features/workspace/hooks/useWorkspaceFileDraft.js';

afterEach(cleanup);

it('retains an unsaved draft until confirmation and rejects a decision for a file that has changed', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project-1', path: 'notes.txt', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  const client = { readProjectFileForEdit: vi.fn(), saveProjectFile: vi.fn() };
  const view = renderHook(({ currentFile }) => useWorkspaceFileDraft({
    client, file: currentFile, onFilePrepared: vi.fn(), onFileSaved: vi.fn(),
  }), { initialProps: { currentFile: file }, wrapper: ConfirmationProvider });
  expect(view.result.current.editing).toBe(true);
  act(() => view.result.current.updateContent('unsaved edit'));
  let decision!: Promise<boolean>;
  act(() => { decision = view.result.current.confirmDiscardChanges(); });
  expect(view.result.current.dirty).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await act(async () => { expect(await decision).toBe(false); });
  expect(view.result.current.content).toBe('unsaved edit');
  expect(view.result.current.dirty).toBe(true);

  act(() => { decision = view.result.current.confirmDiscardChanges(); });
  view.rerender({ currentFile: { ...file, path: 'another.txt' } });
  fireEvent.click(await screen.findByRole('button', { name: '确认' }));
  await act(async () => { expect(await decision).toBe(false); });
  expect(view.result.current.content).toBe('original');
  expect(client.saveProjectFile).not.toHaveBeenCalled();
});

describe('canEditWorkspaceFile', () => {
  const textFile: WorkspaceFileRead = {
    projectId: 'project-1',
    path: 'src/example.ts',
    content: 'export {};\n',
    size: 11,
    preview: { kind: 'text' },
    revision: 'revision-1',
    truncated: false,
  };

  it('enables revisioned text files that can be fully loaded into the editor', () => {
    expect(canEditWorkspaceFile(textFile)).toBe(true);
    expect(canEditWorkspaceFile({ ...textFile, truncated: true })).toBe(true);
    expect(canEditWorkspaceFile({ ...textFile, revision: undefined })).toBe(false);
    expect(canEditWorkspaceFile({ ...textFile, size: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES + 1 })).toBe(false);
    expect(canEditWorkspaceFile({ ...textFile, preview: { kind: 'unsupported', reason: 'binary' } })).toBe(false);
  });
});

it('keeps editing through saves, preserves newer input and retries a failed save against the latest revision', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project-1', path: 'notes.txt', content: 'original', size: 8,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: false,
  };
  let finishSave!: (file: WorkspaceFileRead) => void;
  const client = {
    readProjectFileForEdit: vi.fn(),
    saveProjectFile: vi.fn().mockReturnValueOnce(new Promise<WorkspaceFileRead>((resolve) => { finishSave = resolve; })),
  };
  const onFileSaved = vi.fn();
  const view = renderHook(({ currentFile }) => useWorkspaceFileDraft({
    client, file: currentFile, onFilePrepared: vi.fn(), onFileSaved,
  }), { initialProps: { currentFile: file }, wrapper: ConfirmationProvider });
  expect(view.result.current.editing).toBe(true);
  act(() => view.result.current.updateContent('first edit'));
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = view.result.current.save();
    expect(await view.result.current.save()).toBe(false);
  });
  expect(client.saveProjectFile).toHaveBeenCalledTimes(1);
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project-1', 'notes.txt', {
    content: 'first edit', expectedRevision: 'revision-1',
  });
  act(() => view.result.current.updateContent('second edit'));
  const savedFile = { ...file, content: 'first edit', revision: 'revision-2' };
  await act(async () => {
    finishSave(savedFile);
    expect(await saving).toBe(true);
  });
  view.rerender({ currentFile: savedFile });
  expect(onFileSaved).toHaveBeenCalledWith(savedFile);
  expect(view.result.current).toMatchObject({ editing: true, dirty: true, saving: false, content: 'second edit' });

  client.saveProjectFile.mockRejectedValueOnce(new Error('write failed'));
  await act(async () => { expect(await view.result.current.save()).toBe(false); });
  expect(view.result.current).toMatchObject({ editing: true, dirty: true, saving: false, content: 'second edit', error: 'write failed' });
  expect(view.result.current.errorMessage).toContain('write failed');
  client.saveProjectFile.mockResolvedValueOnce({ ...file, content: 'second edit', revision: 'revision-3' });
  await act(async () => { expect(await view.result.current.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenLastCalledWith('project-1', 'notes.txt', {
    content: 'second edit', expectedRevision: 'revision-2',
  });
  expect(view.result.current).toMatchObject({ editing: true, dirty: false, saving: false, content: 'second edit', error: null });
  await act(async () => { expect(await view.result.current.save()).toBe(true); });
  expect(client.saveProjectFile).toHaveBeenCalledTimes(3);
});

it('loads truncated files before editing and ignores preparation results after navigation', async () => {
  const file: WorkspaceFileRead = {
    projectId: 'project-1', path: 'notes.txt', content: 'partial', size: 14,
    revision: 'revision-1', preview: { kind: 'text' }, truncated: true,
  };
  let finishRead!: (file: WorkspaceFileRead) => void;
  const fullFile = { ...file, content: 'complete text', truncated: false };
  const client = {
    readProjectFileForEdit: vi.fn().mockReturnValueOnce(new Promise<WorkspaceFileRead>((resolve) => { finishRead = resolve; }))
      .mockResolvedValueOnce(fullFile),
    saveProjectFile: vi.fn(),
  };
  const onFilePrepared = vi.fn();
  const view = renderHook(({ currentFile }) => useWorkspaceFileDraft({
    client, file: currentFile, onFilePrepared, onFileSaved: vi.fn(),
  }), { initialProps: { currentFile: file }, wrapper: ConfirmationProvider });
  expect(view.result.current).toMatchObject({ editing: false, preparing: true });
  expect(client.readProjectFileForEdit).toHaveBeenCalledWith(file.projectId, file.path);
  view.rerender({ currentFile: { ...file, path: 'other.txt', content: 'other text', truncated: false } });
  await act(async () => { finishRead(fullFile); });
  expect(onFilePrepared).not.toHaveBeenCalled();
  expect(view.result.current).toMatchObject({ editing: true, content: 'other text', preparing: false });

  view.rerender({ currentFile: file });
  await waitFor(() => expect(view.result.current.editing).toBe(true));
  expect(onFilePrepared).toHaveBeenCalledWith(fullFile);
  expect(view.result.current.content).toBe('complete text');
});
