import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { dialog, ipcMain, nativeImage, type BrowserWindow, type Extension, type IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { BROWSER_IPC_CHANNELS } from '../../../src/contracts/bridge.js';
import { extensionPermissions } from '../../../src/main/extensions/confirmation.js';
import { registerBrowserExtensionIpc } from '../../../src/main/extensions/ipc.js';
import { extensionMetadata, extensionPageUrl } from '../../../src/main/extensions/metadata.js';
import type { BrowserExtensionService } from '../../../src/main/extensions/service.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }, dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn(() => ({ isEmpty: () => false, resize: () => ({ toDataURL: () => 'data:image/png;base64,test' }) })) },
}));

const id = 'a'.repeat(32);
const extension = (root: string, manifest: Record<string, unknown>) => ({ id, path: root, name: 'Test', version: '1', manifest }) as Extension;

it('limits extension pages and icon reads to the installed extension', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-metadata-'));
  const root = path.join(directory, 'extension');
  try {
    await mkdir(root);
    await writeFile(path.join(directory, 'outside.png'), 'private');
    await writeFile(path.join(root, 'icon.png'), 'icon');
    for (const page of ['https://example.com/', `chrome-extension://${'b'.repeat(32)}/popup.html`, 'javascript:alert(1)']) {
      expect(extensionPageUrl(extension(root, { action: { default_popup: page } }), 'popup')).toBeNull();
      expect(extensionPageUrl(extension(root, { chrome_url_overrides: { newtab: page } }), 'newtab')).toBeNull();
    }
    expect(extensionPageUrl(extension(root, { options_ui: { page: 'options.html' } }), 'options')).toBe(`chrome-extension://${id}/options.html`);
    expect(extensionPageUrl(extension(root, { chrome_url_overrides: { newtab: 'newtab.html' } }), 'newtab')).toBe(`chrome-extension://${id}/newtab.html`);
    for (const icon of ['../outside.png', path.join(directory, 'outside.png')]) {
      expect((await extensionMetadata(extension(root, { icons: { 32: icon } }))).icon).toBeNull();
      expect((await extensionMetadata(extension(root, { action: { default_icon: icon } }))).actionIcon).toBeNull();
    }
    if (process.platform !== 'win32') {
      await symlink(path.join(directory, 'outside.png'), path.join(root, 'linked.png'));
      expect((await extensionMetadata(extension(root, { icons: { 32: 'linked.png' } }))).icon).toBeNull();
      expect((await extensionMetadata(extension(root, { action: { default_icon: { 32: 'linked.png' } } }))).actionIcon).toBeNull();
    }
    expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
    expect((await extensionMetadata(extension(root, { icons: { 32: 'icon.png' } }))).icon).toBe('data:image/png;base64,test');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('includes website access from content scripts in installation consent', () => {
  expect(extensionPermissions({ permissions: ['storage'], host_permissions: ['https://example.com/*'],
    content_scripts: [{ matches: ['https://example.com/*', '<all_urls>'] }],
  }, 'en-US')).toEqual(['Store extension data', 'https://example.com/*', '<all_urls>']);
});

it('restricts management to desktop main frames and hides internal operation errors', async () => {
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'extensions', process: 'main' });
  const owner = { isDestroyed: () => false } as BrowserWindow;
  const service = { list: vi.fn(() => []), remove: vi.fn(async () => true), setEnabled: vi.fn(async () => true), setUserScriptsAllowed: vi.fn(async () => true), open: vi.fn(async () => { throw new Error('/private/path'); }) };
  scope.scope.add(registerBrowserExtensionIpc(scope.scope, service as unknown as BrowserExtensionService, (senderId) => senderId === 1 ? owner : null, () => 'en-US'));
  scope.activate();
  const mainFrame = {};
  const invoke = (channel: string, senderId: number, frame: unknown, input?: unknown) => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
    return handler({ sender: { id: senderId, mainFrame }, senderFrame: frame } as IpcMainInvokeEvent, input);
  };
  try {
    for (const channel of [BROWSER_IPC_CHANNELS.getExtensions, BROWSER_IPC_CHANNELS.installUnpackedExtension, BROWSER_IPC_CHANNELS.removeExtension, BROWSER_IPC_CHANNELS.openExtension, BROWSER_IPC_CHANNELS.setExtensionEnabled, BROWSER_IPC_CHANNELS.setExtensionUserScriptsAllowed]) {
      await expect(invoke(channel, 2, mainFrame, { id, view: 'popup' })).resolves.toBeNull();
      await expect(invoke(channel, 1, {}, { id, view: 'popup' })).resolves.toBeNull();
    }
    expect(service.list).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
    expect(service.setEnabled).not.toHaveBeenCalled();
    expect(service.setUserScriptsAllowed).not.toHaveBeenCalled();
    for (const allowed of [undefined, 'false', 0, null]) {
      await expect(invoke(BROWSER_IPC_CHANNELS.setExtensionUserScriptsAllowed, 1, mainFrame, { id, allowed })).resolves.toBe(false);
    }
    await expect(invoke(BROWSER_IPC_CHANNELS.setExtensionUserScriptsAllowed, 1, mainFrame, { id, allowed: true })).resolves.toBe(true);
    expect(service.setUserScriptsAllowed).toHaveBeenCalledExactlyOnceWith(id, true);
    for (const enabled of [undefined, 'false', 0, null]) {
      await expect(invoke(BROWSER_IPC_CHANNELS.setExtensionEnabled, 1, mainFrame, { id, enabled })).resolves.toBe(false);
    }
    expect(service.setEnabled).not.toHaveBeenCalled();
    await expect(invoke(BROWSER_IPC_CHANNELS.setExtensionEnabled, 1, mainFrame, { id, enabled: false })).resolves.toBe(true);
    expect(service.setEnabled).toHaveBeenCalledExactlyOnceWith(id, false);
    await expect(invoke(BROWSER_IPC_CHANNELS.openExtension, 1, mainFrame, { id, view: 'arbitrary' })).resolves.toBe(false);
    for (const x of [NaN, Infinity, -1, '10']) {
      await expect(invoke(BROWSER_IPC_CHANNELS.openExtension, 1, mainFrame, {
        id, view: 'popup', anchor: { x, y: 0, width: 20, height: 20 },
      })).resolves.toBe(false);
    }
    expect(service.open).not.toHaveBeenCalled();
    await expect(invoke(BROWSER_IPC_CHANNELS.openExtension, 1, mainFrame, { id, view: 'popup' })).rejects.toThrow('Browser extension operation failed.');
    await expect(invoke(BROWSER_IPC_CHANNELS.removeExtension, 1, mainFrame, { id })).resolves.toBe(true);
  } finally { await scope.finishDispose(); }
});

it('uses the native picker instead of renderer paths and confirms the staged permissions', async () => {
  vi.mocked(ipcMain.handle).mockClear();
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'extension-install', process: 'main' });
  const owner = { isDestroyed: () => false } as BrowserWindow;
  const snapshot = extension('/staged/extension', { permissions: ['storage'], host_permissions: ['https://example.org/*'] });
  const service = { installUnpacked: vi.fn(async (_directory: string, _signal: AbortSignal, confirm: (item: Extension) => Promise<boolean>) => {
    return await confirm(snapshot) ? { status: 'installed' } : { status: 'cancelled' };
  }) };
  scope.scope.add(registerBrowserExtensionIpc(scope.scope, service as unknown as BrowserExtensionService, () => owner, () => 'en-US'));
  scope.activate();
  const frame = {};
  const invoke = () => vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === BROWSER_IPC_CHANNELS.installUnpackedExtension)![1](
    { sender: { id: 1, mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent, { directory: '/renderer-selected' });
  try {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(invoke()).resolves.toEqual({ status: 'cancelled' });
    expect(service.installUnpacked).not.toHaveBeenCalled();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/native-selected'] });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    await expect(invoke()).resolves.toEqual({ status: 'cancelled' });
    expect(service.installUnpacked).toHaveBeenLastCalledWith('/native-selected', expect.any(AbortSignal), expect.any(Function));
    expect(dialog.showMessageBox).toHaveBeenCalledWith(owner, expect.objectContaining({ detail: expect.stringContaining('https://example.org/*') }));
    vi.mocked(dialog.showOpenDialog).mockRejectedValueOnce(new Error('/private/path'));
    await expect(invoke()).rejects.toThrow('Browser extension operation failed.');
    vi.mocked(dialog.showOpenDialog).mockImplementationOnce(() => new Promise(() => undefined));
    const pending = invoke();
    await scope.finishDispose();
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  } finally { await scope.finishDispose(); }
});
