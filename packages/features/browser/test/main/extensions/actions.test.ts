import { EventEmitter } from 'node:events';
import { ipcMain, type Extension, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { BROWSER_EXTENSION_ACTION_CHANNEL } from '../../../src/contracts/extensions.js';
import { BrowserExtensionActions } from '../../../src/main/extensions/actions.js';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }, nativeImage: {} }));

it('accepts only installed extension origins and managed tabs, and isolates overrides across navigation', async () => {
  const id = 'a'.repeat(32);
  const origin = `chrome-extension://${id}/`;
  const extension = { id } as Extension;
  const workers = Object.assign(new EventEmitter(), { getAllRunning: () => ({}) });
  const session = { serviceWorkers: workers, registerPreloadScript: vi.fn(() => 'preload'), unregisterPreloadScript: vi.fn() } as unknown as Session;
  const actions = new BrowserExtensionActions(session, (url) => url.startsWith(origin) ? extension : null, vi.fn());
  actions.start('/extension-preload.cjs');
  const first = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) as unknown as WebContents;
  const second = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false }) as unknown as WebContents;
  actions.track(first); actions.track(second);
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === BROWSER_EXTENSION_ACTION_CHANNEL)![1];
  const invoke = (input: unknown, url = `${origin}popup.html`, senderSession = session) => handler({
    sender: { session: senderSession }, senderFrame: { url },
  } as IpcMainInvokeEvent, input);
  try {
    const update = { method: 'setTitle', title: 'Detected', tabId: 1 };
    expect(await invoke(update, 'https://example.com/')).toBe(false);
    expect(await invoke(update, `${origin}popup.html`, {} as Session)).toBe(false);
    expect(await invoke({ ...update, tabId: 999 })).toBe(false);
    expect(await invoke({ method: 'setPopup', popup: 'https://example.com/', tabId: 1 })).toBe(false);
    expect(actions.snapshot(1)).toEqual([]);
    expect(await invoke({ method: 'setTitle', title: 'Default' })).toBe(true);
    expect(await invoke(update)).toBe(true);
    expect(await invoke({ method: 'setPopup', popup: 'active.html', tabId: 1 })).toBe(true);
    expect(actions.snapshot(1)).toEqual([{ id, title: 'Detected', popup: `${origin}active.html` }]);
    expect(actions.snapshot(2)).toEqual([{ id, title: 'Default' }]);
    first.emit('did-navigate-in-page', {}, 'https://example.com/#anchor', true);
    expect(actions.snapshot(1)[0].title).toBe('Detected');
    first.emit('did-navigate', {}, 'https://another.example/');
    expect(actions.snapshot(1)).toEqual([{ id, title: 'Default' }]);
    first.emit('destroyed');
    expect(await invoke(update)).toBe(false);
    actions.remove(id);
    expect(actions.snapshot(2)).toEqual([]);
  } finally { actions.dispose(); }
});

it('uses MV2 toolbar state for legacy getters and rejects invalid tabs, external popups and unsupported badges', async () => {
  const extension = { id: 'b'.repeat(32), name: 'Legacy', manifest: { manifest_version: 2,
    browser_action: { default_title: 'Default', default_popup: 'popup.html' } } } as Extension;
  const actions = new BrowserExtensionActions({} as Session, () => extension, vi.fn());
  const tab = Object.assign(new EventEmitter(), { id: 10, isDestroyed: () => false }) as unknown as WebContents;
  actions.track(tab);
  expect(await actions.legacyCall(extension, 'getTitle', [{}])).toBe('Default');
  expect(await actions.legacyCall(extension, 'getPopup', [{}])).toBe(`chrome-extension://${extension.id}/popup.html`);
  await actions.legacyCall(extension, 'setTitle', [{ tabId: 10, title: 'Selected' }]);
  expect(await actions.legacyCall(extension, 'getTitle', [{ tabId: 10 }])).toBe('Selected');
  await expect(actions.legacyCall(extension, 'setTitle', [{ tabId: 99, title: 'Foreign' }])).rejects.toThrow('Browser tab unavailable');
  await expect(actions.legacyCall(extension, 'setPopup', [{ popup: 'https://external.test/' }])).rejects.toThrow('Invalid action details');
  await expect(actions.legacyCall(extension, 'setBadgeText', [{ text: '1' }])).rejects.toThrow('Unsupported browserAction method');
  await expect(actions.legacyCall({ ...extension, manifest: { manifest_version: 3 } }, 'setTitle', [{ title: 'MV3' }])).rejects.toThrow('browserAction unavailable');
  tab.emit('destroyed');
  await expect(actions.legacyCall(extension, 'getTitle', [{ tabId: 10 }])).rejects.toThrow('Browser tab unavailable');
});
