import { EventEmitter } from 'node:events';
import { ipcMain, type BrowserWindow, type Extension, type IpcMainInvokeEvent, type ServiceWorkerMain, type Session, type WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { EXTENSION_UI_CHANNELS as channels, type ExtensionUiEvent } from '../../../src/contracts/extension-api.js';
import { BrowserExtensionActiveTabs } from '../../../src/main/extensions/active-tabs.js';
import { BrowserExtensionUi } from '../../../src/main/extensions/ui.js';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { app: new EventEmitter(), nativeImage: {},
    ipcMain: Object.assign(new EventEmitter(), { handle: vi.fn(), removeHandler: vi.fn() }) };
});

it('closes a configured panel before worker startup can overwrite its action behavior', async () => {
  const extension = { id: 'a'.repeat(32), manifest: {
    permissions: ['sidePanel'], side_panel: { default_path: 'panel.html' }, background: { service_worker: 'worker.js' },
  } } as Extension;
  const owner = Object.assign(new EventEmitter(), {
    id: 1, isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() },
  }) as unknown as BrowserWindow;
  const workers = Object.assign(new EventEmitter(), {
    // Model the native boundary completing a dormant worker's initialization.
    startWorkerForScope: vi.fn(async () => {
      ui.panels.options.setBehavior(extension.id, { openPanelOnActionClick: false });
      return { scope: `chrome-extension://${extension.id}/` } as ServiceWorkerMain;
    }),
  });
  const session = Object.assign(new EventEmitter(), {
    serviceWorkers: workers,
    extensions: Object.assign(new EventEmitter(), { getExtension: () => extension }),
  }) as unknown as Session;
  const ui = new BrowserExtensionUi({ session, resolve: () => extension, owner: () => owner,
    windows: () => [owner], activeOwner: () => owner, activeTabs: new BrowserExtensionActiveTabs(() => true) });
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, session }) as unknown as WebContents;
  const event = { type: 'frame', sender: contents, senderFrame: {
    processId: 1, routingId: 1, url: `chrome-extension://${extension.id}/panel.html`, isDestroyed: () => false,
    send: (_channel: string, event: ExtensionUiEvent) => {
      if (event.kind === 'actionClicked') ui.panels.show(extension, owner);
    },
  } } as unknown as IpcMainInvokeEvent;
  ui.start();
  try {
    ipcMain.emit(channels.bootstrap, event);
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === channels.call)![1];
    await handler(event, 'actionListen', [true]);
    ui.panels.options.setBehavior(extension.id, { openPanelOnActionClick: true });
    ui.panels.show(extension, owner);
    expect(await ui.activate(extension, owner)).toBe(true);
    expect(ui.panels.snapshot(owner)).toBeNull();
    expect(workers.startWorkerForScope).not.toHaveBeenCalled();
  } finally { ui.dispose(); }
});
