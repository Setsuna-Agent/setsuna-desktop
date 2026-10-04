import { EventEmitter } from 'node:events';
import { THREAD_DELETION_CHANNELS, type DesktopThreadDeletionState, type RuntimeRequestInput } from '@setsuna-desktop/contracts';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ showMessageBox: vi.fn(), ipcMain: null as unknown as EventEmitter }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  native.ipcMain = new EventEmitter();
  return { ipcMain: native.ipcMain, dialog: { showMessageBox: native.showMessageBox } };
});
import { desktopWindows } from '../../../src/window/registry.js';
import { createThreadDeletionHandler } from '../../../src/window/thread-deletion.js';

afterEach(() => {
  for (const window of desktopWindows.all()) window.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
  native.showMessageBox.mockReset();
  native.ipcMain.removeAllListeners();
});

it.each(['renderer', 'runtime'] as const)('waits for both windows and explicit consent for %s deletion, including a child conversation', async (origin) => {
  const source = windowFixture(1, { threadId: 'parent', dirty: false, busy: false });
  const other = windowFixture(2, { threadId: 'child', dirty: true, busy: false });
  let answer!: (result: { response: number }) => void;
  native.showMessageBox.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  const { remove, request } = setup();
  const pending = remove(origin === 'renderer' ? source.window.webContents : null, deletion);
  await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalledOnce());
  expect(request).not.toHaveBeenCalledWith(deletion);
  expect(other.send).not.toHaveBeenCalledWith(THREAD_DELETION_CHANNELS.finished, expect.anything());
  answer({ response: 1 });
  await expect(pending).resolves.toEqual({ ok: true });
  expect(request).toHaveBeenCalledWith(deletion);
  expect(other.send).toHaveBeenLastCalledWith(THREAD_DELETION_CHANNELS.finished, { deletedThreadIds: ['parent', 'child'] });
});

it.each([
  ['renderer', 'cancel'], ['renderer', 'failure'], ['renderer', 'busy'],
  ['runtime', 'cancel'], ['runtime', 'failure'], ['runtime', 'busy'],
] as const)('releases every window without discarding drafts on %s %s', async (origin, scenario) => {
  const source = windowFixture(1, { threadId: 'parent', dirty: false, busy: false });
  const other = windowFixture(2, { threadId: 'parent', dirty: true, busy: scenario === 'busy' });
  native.showMessageBox.mockResolvedValue({ response: scenario === 'cancel' ? 0 : 1 });
  const { remove, request } = setup(scenario === 'failure');
  const sender = origin === 'renderer' ? source.window.webContents : null;
  if (scenario === 'cancel') await expect(remove(sender, deletion)).resolves.toEqual({ cancelled: true });
  else await expect(remove(sender, deletion)).rejects.toThrow();
  if (scenario !== 'failure') expect(request).not.toHaveBeenCalledWith(deletion);
  if (scenario === 'busy') expect(native.showMessageBox).not.toHaveBeenCalled();
  expect(other.send).toHaveBeenLastCalledWith(THREAD_DELETION_CHANNELS.finished, { deletedThreadIds: [] });
});

it('shares the deletion queue between runtime and renderer and never deletes an aborted request after confirmation', async () => {
  const source = windowFixture(1, { threadId: 'parent', dirty: true, busy: false });
  let answer!: (result: { response: number }) => void;
  native.showMessageBox.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  const { remove, request } = setup();
  const controller = new AbortController();
  const cancelled = expect(remove(null, deletion, controller.signal)).rejects.toThrow();
  await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalledOnce());
  const queued = remove(source.window.webContents, deletion);
  controller.abort();
  answer({ response: 1 });
  await cancelled;
  expect(request).not.toHaveBeenCalledWith(deletion);
  await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalledTimes(2));
  answer({ response: 1 });
  await expect(queued).resolves.toEqual({ ok: true });
  expect(request).toHaveBeenCalledExactlyOnceWith(deletion);
});

it('refuses runtime deletion when no desktop window is available', async () => {
  const { remove, request } = setup();
  await expect(remove(null, deletion)).rejects.toThrow('unavailable');
  expect(request).not.toHaveBeenCalled();
});

it('ignores edits in unrelated windows and rejects requests from unregistered renderers', async () => {
  const source = windowFixture(1, { threadId: 'another', dirty: true, busy: true });
  const { remove, request } = setup();
  await remove(source.window.webContents, deletion);
  expect(native.showMessageBox).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith(deletion);
  const foreign = windowFixture(99, null, false);
  await expect(remove(foreign.window.webContents, deletion)).rejects.toThrow('unavailable');
});

it('fails closed when a window cannot answer and removes its pending listeners', async () => {
  vi.useFakeTimers();
  const source = windowFixture(1, { threadId: 'parent', dirty: false, busy: false });
  const unresponsive = windowFixture(2, null);
  const { remove, request } = setup();
  const pending = expect(remove(source.window.webContents, deletion)).rejects.toThrow('Could not check');
  await vi.advanceTimersByTimeAsync(5_001);
  await pending;
  expect(request).not.toHaveBeenCalledWith(deletion);
  expect(native.ipcMain.listenerCount(THREAD_DELETION_CHANNELS.checked)).toBe(0);
  expect(unresponsive.send).toHaveBeenLastCalledWith(THREAD_DELETION_CHANNELS.finished, { deletedThreadIds: [] });
});

const deletion: RuntimeRequestInput = { path: '/v1/threads/parent', method: 'DELETE' };
function setup(fail = false) {
  const request = vi.fn(async (input: RuntimeRequestInput) => {
    if (input.method !== 'DELETE') return { parentThreadId: input.path.includes('/child?') ? 'parent' : undefined };
    if (fail) throw new Error('Delete failed');
    return { ok: true };
  });
  return { request, remove: createThreadDeletionHandler({ request: request as never }, () => 'zh-CN') };
}

function windowFixture(id: number, state: DesktopThreadDeletionState | null, registered = true) {
  let destroyed = false;
  const send = vi.fn((channel: string, requestId: unknown) => {
    if (channel === THREAD_DELETION_CHANNELS.check && state) {
      native.ipcMain.emit(THREAD_DELETION_CHANNELS.checked, { sender: webContents }, { requestId, state });
    }
  });
  const webContents = Object.assign(new EventEmitter(), { id, send, isDestroyed: () => destroyed });
  const window = Object.assign(new EventEmitter(), {
    webContents, isDestroyed: () => destroyed, isFocused: () => id === 1,
    destroy: () => { destroyed = true; webContents.emit('destroyed'); window.emit('closed'); },
  }) as unknown as BrowserWindow;
  if (registered) desktopWindows.add(window);
  return { window, send };
}
