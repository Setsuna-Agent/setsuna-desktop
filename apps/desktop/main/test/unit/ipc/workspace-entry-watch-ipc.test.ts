import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { WORKSPACE_ENTRIES_WATCH_CHANNELS } from '@setsuna-desktop/contracts';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  watch: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => { mocks.handlers.set(channel, handler); },
  removeHandler: (channel: string) => { mocks.handlers.delete(channel); },
} }));
vi.mock('../../../src/workspace/entry-watcher.js', () => ({ watchWorkspaceEntries: mocks.watch }));
import { registerWorkspaceEntryWatchIpc } from '../../../src/ipc/workspace-entry-watch-ipc.js';

beforeEach(() => { mocks.watch.mockReset(); });

it('keeps tree and editor subscriptions independent, including out-of-order setup and unsubscribe', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: vi.fn() });
  const mainWindow = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow;
  let finishFirst!: (dispose: () => void) => void;
  const firstDispose = vi.fn();
  const secondDispose = vi.fn();
  mocks.watch.mockReturnValueOnce(new Promise<() => void>((resolve) => { finishFirst = resolve; }))
    .mockResolvedValueOnce(secondDispose);
  registerWorkspaceEntryWatchIpc(mainWindow);
  const subscribe = mocks.handlers.get(WORKSPACE_ENTRIES_WATCH_CHANNELS.subscribe)!;
  const unsubscribe = mocks.handlers.get(WORKSPACE_ENTRIES_WATCH_CHANNELS.unsubscribe)!;
  const first = subscribe({ sender }, { subscriptionId: 'first', workspaceRoot: '/first', directoryPaths: [''] });
  await subscribe({ sender }, { subscriptionId: 'second', workspaceRoot: '/second', directoryPaths: [''] });
  finishFirst(firstDispose);
  await first;
  expect(firstDispose).not.toHaveBeenCalled();
  mocks.watch.mock.calls[0][2]();
  mocks.watch.mock.calls[1][2]();
  expect(sender.send.mock.calls).toEqual(['first', 'second'].map((subscriptionId) => [WORKSPACE_ENTRIES_WATCH_CHANNELS.changed, { subscriptionId }]));
  unsubscribe({ sender: { id: 2 } }, 'second');
  expect(secondDispose).not.toHaveBeenCalled();
  unsubscribe({ sender }, 'first');
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(secondDispose).not.toHaveBeenCalled();
  mocks.watch.mock.calls[0][2]();
  mocks.watch.mock.calls[1][2]();
  expect(sender.send).toHaveBeenCalledTimes(3);
  expect(sender.send).toHaveBeenLastCalledWith(WORKSPACE_ENTRIES_WATCH_CHANNELS.changed, { subscriptionId: 'second' });
  await expect(subscribe({ sender: { id: 2 } }, { subscriptionId: 'foreign' })).rejects.toThrow('unavailable');
  sender.emit('destroyed');
  expect(secondDispose).toHaveBeenCalledOnce();
  mocks.watch.mock.calls[1][2]();
  expect(sender.send).toHaveBeenCalledTimes(3);
});

it('disposes replaced or navigated subscriptions that finish setup late without cancelling current consumers', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: vi.fn() });
  const mainWindow = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow;
  const staleDispose = vi.fn();
  const currentDispose = vi.fn();
  const pendingDispose = vi.fn();
  let finishStale!: (dispose: () => void) => void;
  let finishPending!: (dispose: () => void) => void;
  mocks.watch.mockReturnValueOnce(new Promise<() => void>((resolve) => { finishStale = resolve; }))
    .mockResolvedValueOnce(currentDispose)
    .mockReturnValueOnce(new Promise<() => void>((resolve) => { finishPending = resolve; }));
  registerWorkspaceEntryWatchIpc(mainWindow);
  const subscribe = mocks.handlers.get(WORKSPACE_ENTRIES_WATCH_CHANNELS.subscribe)!;
  const input = { subscriptionId: 'tree', workspaceRoot: '/root', directoryPaths: [''] };
  const stale = subscribe({ sender }, input);
  await subscribe({ sender }, input);
  finishStale(staleDispose);
  await stale;
  expect(staleDispose).toHaveBeenCalledOnce();
  expect(currentDispose).not.toHaveBeenCalled();
  mocks.watch.mock.calls[0][2]();
  mocks.watch.mock.calls[1][2]();
  expect(sender.send).toHaveBeenCalledOnce();

  const pending = subscribe({ sender }, { ...input, subscriptionId: 'editor' });
  sender.emit('did-start-navigation', {}, '', true, true);
  expect(currentDispose).not.toHaveBeenCalled();
  sender.emit('did-start-navigation', {}, '', false, true);
  expect(currentDispose).toHaveBeenCalledOnce();
  finishPending(pendingDispose);
  await pending;
  expect(pendingDispose).toHaveBeenCalledOnce();
  mocks.watch.mock.calls[1][2]();
  mocks.watch.mock.calls[2][2]();
  expect(sender.send).toHaveBeenCalledOnce();
  sender.emit('render-process-gone');
  expect(currentDispose).toHaveBeenCalledOnce();
  expect(pendingDispose).toHaveBeenCalledOnce();
});
