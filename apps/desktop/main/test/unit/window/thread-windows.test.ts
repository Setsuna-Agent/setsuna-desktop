import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>());
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (event: IpcMainInvokeEvent, input?: unknown) => unknown) => handlers.set(channel, handler),
  removeHandler: (channel: string) => handlers.delete(channel),
} }));
import { desktopWindows } from '../../../src/window/registry.js';
import { loadDesktopRenderer } from '../../../src/window/renderer-loading.js';
import { registerThreadWindowIpc } from '../../../src/window/thread-windows.js';

afterEach(() => {
  for (const window of desktopWindows.all()) window.destroy();
  handlers.clear();
});

it('opens the requested conversation in an independent trusted window and preserves readiness after the first closes', async () => {
  const source = windowFixture(1);
  const target = windowFixture(2);
  const attached = vi.fn(() => vi.fn());
  desktopWindows.add(source.window);
  const unsubscribe = desktopWindows.onWindowAdded(attached);
  await loadDesktopRenderer(source.window, { appRoot: '/app' });
  const validateThread = vi.fn(async () => undefined);
  const createWindow = vi.fn(() => target.window);
  registerThreadWindowIpc({ appRoot: '/app', validateThread, createWindow });

  await invoke('window-control:open-thread', source.window, 'thread-selected');
  expect(validateThread).toHaveBeenCalledExactlyOnceWith('thread-selected');
  expect(createWindow).toHaveBeenCalledOnce();
  expect(target.native.show).toHaveBeenCalledOnce();
  expect(target.native.loadFile).toHaveBeenCalledOnce();
  expect(invoke('window-control:get-initial-thread-id', target.window)).toBe('thread-selected');
  expect(invoke('window-control:get-initial-thread-id', source.window)).toBeNull();
  expect(attached).toHaveBeenCalledTimes(2);

  source.window.destroy();
  expect(desktopWindows.get(1)).toBeNull();
  expect(desktopWindows.get(2)).toBe(target.window);
  await expect(invoke('desktop:when-ready', target.window)).resolves.toBeUndefined();
  desktopWindows.publish('runtime:test', { threadId: 'thread-selected' });
  expect(target.native.webContents.send).toHaveBeenCalledExactlyOnceWith('runtime:test', { threadId: 'thread-selected' });
  expect(source.native.webContents.send).not.toHaveBeenCalled();
  unsubscribe();
});

it('rejects foreign renderers, invalid input, and unavailable conversations before creating a window', async () => {
  const source = windowFixture(1);
  const foreign = windowFixture(9);
  desktopWindows.add(source.window);
  const createWindow = vi.fn();
  const validateThread = vi.fn(async () => { throw new Error('Thread not found'); });
  registerThreadWindowIpc({ appRoot: '/app', validateThread, createWindow });
  await expect(invoke('window-control:open-thread', foreign.window, 'thread-1')).rejects.toThrow('unavailable');
  await expect(invoke('window-control:open-thread', source.window, ' ')).rejects.toThrow('required');
  await expect(invoke('window-control:open-thread', source.window, 'missing')).rejects.toThrow('Thread not found');
  expect(validateThread).toHaveBeenCalledExactlyOnceWith('missing');
  expect(createWindow).not.toHaveBeenCalled();
});

it('removes a failed window without breaking the original renderer', async () => {
  const source = windowFixture(1);
  const target = windowFixture(2);
  desktopWindows.add(source.window);
  await loadDesktopRenderer(source.window, { appRoot: '/app' });
  target.native.loadFile.mockRejectedValueOnce(new Error('Load failed'));
  registerThreadWindowIpc({ appRoot: '/app', validateThread: async () => undefined, createWindow: () => target.window });
  await expect(invoke('window-control:open-thread', source.window, 'thread-1')).rejects.toThrow('Load failed');
  expect(desktopWindows.all()).toEqual([source.window]);
  expect(target.native.show).not.toHaveBeenCalled();
  await expect(invoke('desktop:when-ready', source.window)).resolves.toBeUndefined();
});

function invoke(channel: string, window: BrowserWindow, input?: unknown) {
  return handlers.get(channel)!({ sender: window.webContents } as IpcMainInvokeEvent, input);
}

function windowFixture(id: number) {
  let destroyed = false;
  const native = Object.assign(new EventEmitter(), {
    webContents: { id, isDestroyed: () => destroyed, send: vi.fn() },
    isDestroyed: () => destroyed,
    getBounds: () => ({ x: 20, y: 30, width: 1000, height: 700 }),
    loadFile: vi.fn(async () => undefined),
    show: vi.fn(),
    focus: vi.fn(),
    destroy: () => { destroyed = true; native.emit('closed'); },
  });
  return { window: native as unknown as BrowserWindow, native };
}
