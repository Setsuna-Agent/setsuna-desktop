import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type IpcMainInvokeEvent, type Session, type BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { BROWSER_SETTINGS_CHANNELS } from '../../../src/contracts/settings.js';
import { registerBrowserSettingsIpc } from '../../../src/main/settings/ipc.js';
import type { BrowserPreferencesStore } from '../../../src/main/settings/preferences.js';
import { BrowserPasswordStore } from '../../../src/main/passwords/store.js';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }, dialog: {} }));

it('restricts global password management and data clearing to desktop main frames and never returns plaintext credentials', async () => {
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'settings', process: 'main' });
  let raw: string | undefined;
  const passwords = new BrowserPasswordStore({ read: async () => raw, write: async (value) => { raw = value; } });
  await passwords.save('https://example.com', { username: 'alice', password: 'private-credential' });
  const clearData = vi.fn(async () => undefined);
  const session = { clearData, extensions: { getAllExtensions: () => [{ id: 'a'.repeat(32) }] } } as unknown as Session;
  const owner = { isDestroyed: () => false } as BrowserWindow;
  scope.scope.add(registerBrowserSettingsIpc(scope.scope, {} as BrowserPreferencesStore, passwords, session, (senderId) => senderId === 1 ? owner : null));
  scope.activate();
  const mainFrame = {};
  const invoke = (channel: string, input?: unknown, id = 1, frame = mainFrame) => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([key]) => key === channel)![1];
    return handler({ sender: { id, mainFrame }, senderFrame: frame } as IpcMainInvokeEvent, input);
  };
  try {
    await expect(invoke(BROWSER_SETTINGS_CHANNELS.listPasswords, undefined, 2)).rejects.toThrow('Unauthorized');
    await expect(invoke(BROWSER_SETTINGS_CHANNELS.clearData, { passwords: true }, 1, {})).rejects.toThrow('Unauthorized');
    const entries = await invoke(BROWSER_SETTINGS_CHANNELS.listPasswords);
    expect(entries).toEqual([{ id: expect.any(String), origin: 'https://example.com', username: 'alice' }]);
    expect(JSON.stringify(entries)).not.toContain('private-credential');
    await expect(invoke(BROWSER_SETTINGS_CHANNELS.clearData, { everything: true })).rejects.toThrow('Browser settings operation failed.');
    expect(clearData).not.toHaveBeenCalled();
    await invoke(BROWSER_SETTINGS_CHANNELS.clearData, { cache: true });
    expect(clearData).toHaveBeenCalledWith({ dataTypes: ['cache'], excludeOrigins: [`chrome-extension://${'a'.repeat(32)}`] });
    expect(await passwords.list('https://example.com')).toHaveLength(1);
    await invoke(BROWSER_SETTINGS_CHANNELS.clearData, { passwords: true });
    expect(await passwords.listMetadata()).toEqual([]);
  } finally { await scope.finishDispose(); }
});
