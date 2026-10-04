import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { BROWSER_IPC_CHANNELS } from '../../../src/contracts/bridge.js';
import { registerBrowserPasswordIpc } from '../../../src/main/passwords/ipc.js';
import type { BrowserPasswordSession } from '../../../src/main/passwords/session.js';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

it('rejects foreign windows and subframes and releases an unresponsive password operation during shutdown', async () => {
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'passwords', process: 'main' });
  const getState = vi.fn(() => new Promise(() => undefined));
  const resolve = vi.fn((tabId: string, senderId: number) => (
    tabId === 'owned' && senderId === 1 ? { getState } as unknown as BrowserPasswordSession : null
  ));
  scope.scope.add(registerBrowserPasswordIpc(scope.scope, resolve));
  scope.activate();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === BROWSER_IPC_CHANNELS.getPasswordState)![1];
  const mainFrame = {};
  const invoke = (id: number, frame: unknown, tabId = 'owned') => handler({ sender: { id, mainFrame }, senderFrame: frame } as IpcMainInvokeEvent, { tabId });
  await expect(invoke(1, {})).resolves.toBeNull();
  expect(resolve).not.toHaveBeenCalled();
  await expect(invoke(2, mainFrame)).resolves.toBeNull();
  await expect(invoke(1, mainFrame, 'foreign')).resolves.toBeNull();
  expect(getState).not.toHaveBeenCalled();
  const pending = invoke(1, mainFrame);
  await vi.waitFor(() => expect(getState).toHaveBeenCalledOnce());
  const disposal = scope.finishDispose();
  await expect(pending).resolves.toBeNull();
  await disposal;
  expect(scope.scope.state).toBe('disposed');
});
