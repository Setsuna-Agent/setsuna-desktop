// @vitest-environment happy-dom
import type { DesktopRuntimeBridge, DesktopThreadDeletionState, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadDeletionGuard } from '../../../../src/app/controller/useThreadDeletionGuard.js';
import { useWorkspaceFileDraft } from '../../../../src/features/workspace/hooks/useWorkspaceFileDraft.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.inert = false; });

it('keeps the actual file draft on cancellation and failure, allowing it to be saved afterward', async () => {
  const bridge = installGuard();
  const file: WorkspaceFileRead = {
    projectId: 'project', path: 'file.txt', content: 'original', revision: 'v1', size: 8,
    preview: { kind: 'text' }, truncated: false,
  };
  const saveProjectFile = vi.fn(async () => ({ ...file, content: 'unsaved', revision: 'v2' }));
  const { result } = renderHook(() => {
    const draft = useWorkspaceFileDraft({ file, client: { readProjectFileForEdit: vi.fn(), saveProjectFile },
      onFilePrepared: vi.fn(), onFileSaved: vi.fn() });
    useThreadDeletionGuard({ threadId: 'thread', dirty: draft.dirty, busy: draft.saving });
    return draft;
  }, { wrapper: ConfirmationProvider });
  act(() => result.current.updateContent('unsaved'));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expect(bridge.check()).toEqual({ threadId: 'thread', dirty: true, busy: false });
    const key = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    window.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    act(() => bridge.finish([]));
    expect(document.body.inert).toBe(false);
    expect(result.current.content).toBe('unsaved');
    expect(result.current.dirty).toBe(true);
  }
  await act(async () => { expect(await result.current.save()).toBe(true); });
  expect(saveProjectFile).toHaveBeenCalledWith('project', 'file.txt', { content: 'unsaved', expectedRevision: 'v1' });
});

it('keeps input paused between HTTP completion and the deletion event, then releases it on projection or unmount', () => {
  const bridge = installGuard();
  const state: DesktopThreadDeletionState = { threadId: 'thread', dirty: true, busy: false };
  const view = renderHook((current) => useThreadDeletionGuard(current), { initialProps: state });
  bridge.check();
  bridge.finish(['thread']);
  expect(document.body.inert).toBe(true);
  view.rerender({ threadId: null, dirty: false, busy: false });
  expect(document.body.inert).toBe(false);
  bridge.check();
  view.unmount();
  expect(document.body.inert).toBe(false);
  expect(bridge.unsubscribe).toHaveBeenCalledOnce();
});

function installGuard() {
  let check!: Parameters<DesktopRuntimeBridge['onThreadDeletionCheck']>[0];
  let finished!: Parameters<DesktopRuntimeBridge['onThreadDeletionCheck']>[1];
  const unsubscribe = vi.fn();
  const runtime: Pick<DesktopRuntimeBridge, 'onThreadDeletionCheck'> = { onThreadDeletionCheck: (onCheck, onFinished) => {
    check = onCheck; finished = onFinished; return unsubscribe;
  } };
  vi.stubGlobal('setsunaDesktop', { runtime });
  return { check: () => check(), finish: (deletedThreadIds: string[]) => finished({ deletedThreadIds }), unsubscribe };
}
