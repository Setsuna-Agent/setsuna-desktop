import { EventEmitter } from 'node:events';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { BROWSER_IPC_CHANNELS } from '../../src/contracts/index.js';
import type { BrowserAutomation } from '../../src/main/cdp/automation.js';
import type { BrowserDeviceEmulator } from '../../src/main/cdp/device-emulation.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { DesktopBrowserController } from '../../src/main/control.js';
import { registerBrowserIpc } from '../../src/main/ipc.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  clipboard: {}, nativeImage: {}, session: {}, webContents: {}, Menu: {}, screen: {},
}));

afterEach(() => vi.clearAllMocks());

function fixture() {
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'browser-main', process: 'main' });
  const controller = new DesktopBrowserController({
    createAutomation: () => ({ dispose: vi.fn() }) as unknown as BrowserAutomation,
    createDeviceEmulator: () => ({ dispose: vi.fn() }) as unknown as BrowserDeviceEmulator,
  });
  const contents = Object.assign(new EventEmitter(), {
    id: 2, hostWebContents: { id: 1, isDestroyed: () => false, send: vi.fn() }, session: { getUserAgent: () => '' },
    focus: vi.fn(), isDestroyed: () => false,
    // A guest that does not respond must not keep the application's drain open.
    executeJavaScriptInIsolatedWorld: vi.fn((_world: number, _scripts: Array<{ code: string }>) => new Promise<unknown>(() => undefined)),
    capturePage: vi.fn(async () => ({
      isEmpty: () => false, toPNG: () => Buffer.from('image'), getSize: () => ({ width: 100, height: 100 }),
    })),
  });
  controller.registerTab('tab-1', contents as unknown as WebContents);
  scope.scope.add(() => controller.clear());
  const windowSession = {
    window: { isDestroyed: () => false } as BrowserWindow,
    contextMenus: {} as BrowserContextMenuSession,
  };
  scope.scope.add(registerBrowserIpc(scope.scope, controller, new Map([[1, windowSession], [3, windowSession]]), () => 'en-US'));
  scope.activate();
  const invoke = (channel: string, input: Record<string, unknown> = {}, senderId = 1) => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([registered]) => registered === channel)![1];
    return handler({ sender: { id: senderId } } as IpcMainInvokeEvent, { tabId: 'tab-1', ...input });
  };
  return { scope, controller, contents, invoke };
}

it('opens page find only for a registered tab owned by the requesting window', async () => {
  const { scope, contents, invoke } = fixture();
  await expect(invoke(BROWSER_IPC_CHANNELS.requestFindInPage)).resolves.toBe(true);
  expect(contents.hostWebContents.send).toHaveBeenCalledExactlyOnceWith(BROWSER_IPC_CHANNELS.findInPageRequested, 'tab-1');
  await expect(invoke(BROWSER_IPC_CHANNELS.requestFindInPage, { tabId: 'missing' })).resolves.toBe(false);
  await expect(invoke(BROWSER_IPC_CHANNELS.requestFindInPage, {}, 3)).resolves.toBe(false);
  await expect(invoke(BROWSER_IPC_CHANNELS.requestFindInPage, {}, 99)).resolves.toBe(false);
  expect(contents.hostWebContents.send).toHaveBeenCalledOnce();
  await scope.finishDispose();
});

it.each([false, true])('drains annotation IPC without waiting for guest script cleanup (explicit cancel: %s)', async (explicitCancel) => {
  const { scope, controller, contents, invoke } = fixture();
  const selection = invoke(BROWSER_IPC_CHANNELS.pickAnnotation);
  expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
  try {
    if (explicitCancel) {
      // Closing annotations must finish even before scope draining starts.
      await expect(invoke(BROWSER_IPC_CHANNELS.cancelAnnotation)).resolves.toBeUndefined();
    }
    const disposal = scope.finishDispose();
    await expect(selection).resolves.toBeNull();
    await disposal;
    expect(scope.scope.state).toBe('disposed');
  } finally {
    controller.clear();
  }
});

it.each(['anchor', 'sync', 'prepare-screenshot', 'capture', 'finish-screenshot'])(
  'releases annotation IPC locally when shutdown interrupts %s', async (phase) => {
    const { scope, controller, contents, invoke } = fixture();
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(null);
    await invoke(BROWSER_IPC_CHANNELS.pickAnnotation);
    let finish!: (value: true) => void;
    let fail!: (error: Error) => void;
    const blocked = new Promise<true>((resolve, reject) => { finish = resolve; fail = reject; });
    let waiting = false;
    contents.executeJavaScriptInIsolatedWorld.mockImplementation((_world, scripts) => {
      if (scripts[0].code.includes(`"kind":"${phase}"`)) {
        waiting = true;
        return blocked;
      }
      return Promise.resolve(true);
    });
    if (phase === 'capture') contents.capturePage.mockImplementationOnce(async () => {
      waiting = true;
      await blocked;
      return { isEmpty: () => false, toPNG: () => Buffer.from('late'), getSize: () => ({ width: 100, height: 100 }) };
    });
    const id = '27f0b1c9-8c70-452e-8cce-2dd7e029f084';
    const pending = phase === 'anchor'
      ? invoke(BROWSER_IPC_CHANNELS.getAnnotationAnchor, { annotationId: id })
      : phase === 'sync'
        ? invoke(BROWSER_IPC_CHANNELS.setAnnotationMarkers, { markers: { ids: [id], visible: true } })
        : invoke(BROWSER_IPC_CHANNELS.captureAnnotationScreenshots, { annotationIds: [id, '73ccbf8f-6ff7-40c8-920e-f21b45430d38'] });
    try {
      await vi.waitFor(() => expect(waiting).toBe(true));
      const disposal = scope.finishDispose();
      await expect(pending).resolves.toBe(phase === 'sync' ? false : null);
      await disposal;
      expect(scope.scope.state).toBe('disposed');
      // Late preparation must not start a capture; late failures must remain observed.
      if (phase === 'prepare-screenshot') finish(true);
      else fail(new Error('Guest became unavailable'));
      await blocked.catch(() => undefined);
      expect(contents.capturePage).toHaveBeenCalledTimes(phase === 'finish-screenshot' ? 2 : phase === 'capture' ? 1 : 0);
    } finally {
      controller.clear();
    }
  },
);
