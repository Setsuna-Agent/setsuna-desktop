import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn() },
  session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn() }) },
}));
import { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import { BROWSER_IPC_CHANNELS } from '../../src/contracts/bridge.js';

function windowFixture(isAllowedExtensionUrl?: (url: string) => boolean, tabId: string | null = null) {
  let destroyed = false;
  const contents = new EventEmitter();
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
  }) as unknown as BrowserWindow;
  Object.defineProperty(window, 'webContents', { get: () => {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return contents;
  } });
  const dispose = installEmbeddedBrowserWebviews({
    mainWindow: window,
    activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: () => tabId,
    interfaceLanguage: () => 'zh-CN',
    contextMenus: new BrowserContextMenuSession(vi.fn()),
    isAllowedExtensionUrl,
  });
  window.once('closed', dispose);
  return { contents, dispose, close: () => {
    destroyed = true;
    contents.emit('destroyed');
    window.emit('closed');
  } };
}

it('only attaches extension documents authorized by the installed-extension service', () => {
  const extensionUrl = `chrome-extension://${'a'.repeat(32)}/newtab.html`;
  const host = windowFixture((url) => url === extensionUrl);
  for (const [src, blocked] of [[extensionUrl, false], [`chrome-extension://${'b'.repeat(32)}/newtab.html`, true], ['file:///private/test', true]] as const) {
    const event = { preventDefault: vi.fn() };
    const preferences = { preload: '/desktop/preload.js', nodeIntegration: true, contextIsolation: false, sandbox: false };
    host.contents.emit('will-attach-webview', event, preferences, { src });
    expect(event.preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0);
    expect(preferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
    expect(preferences.preload).toBeUndefined();
  }
  host.close();
});

it('routes Ctrl+F and Command+F to the focused guest instead of forwarding chat search, without requiring active chat bindings', () => {
  const host = windowFixture(undefined, 'browser-tab');
  const send = vi.fn();
  const guest = Object.assign(new EventEmitter(), {
    id: 42, setWindowOpenHandler: vi.fn(), hostWebContents: { isDestroyed: () => false, send },
  });
  host.contents.emit('did-attach-webview', {}, guest);
  const key = { type: 'keyDown', code: 'KeyF', key: 'f', alt: false, control: false, shift: false, meta: false,
    isAutoRepeat: false, isComposing: false, modifiers: [] };
  for (const modifier of ['control', 'meta']) {
    const event = { preventDefault: vi.fn() };
    guest.emit('before-input-event', event, { ...key, [modifier]: true });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
  expect(send.mock.calls).toEqual([
    [BROWSER_IPC_CHANNELS.findInPageRequested, 'browser-tab'],
    [BROWSER_IPC_CHANNELS.findInPageRequested, 'browser-tab'],
  ]);
  for (const changes of [{ shift: true }, { alt: true }, { isComposing: true }, { isAutoRepeat: true }]) {
    const event = { preventDefault: vi.fn() };
    guest.emit('before-input-event', event, { ...key, control: true, ...changes });
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  expect(send).toHaveBeenCalledTimes(2);
  host.close();
});

it('cleans up a closed secondary window without touching the surviving window', () => {
  const primary = windowFixture();
  const secondary = windowFixture();
  expect(() => secondary.close()).not.toThrow();
  expect(secondary.contents.listenerCount('will-attach-webview')).toBe(0);
  expect(secondary.contents.listenerCount('did-attach-webview')).toBe(0);
  expect(primary.contents.listenerCount('will-attach-webview')).toBe(1);
  expect(primary.contents.listenerCount('did-attach-webview')).toBe(1);
  expect(() => primary.close()).not.toThrow();
});

it.each(['guest-first', 'window-first'])('releases guest listeners with %s destruction', (order) => {
  const host = windowFixture();
  let destroyed = false;
  const guest = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
  Object.defineProperty(guest, 'id', { get: () => {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return 42;
  } });
  host.contents.emit('did-attach-webview', {}, guest as unknown as WebContents);
  const destroyGuest = () => { destroyed = true; guest.emit('destroyed'); };
  if (order === 'guest-first') {
    expect(destroyGuest).not.toThrow();
    expect(host.close).not.toThrow();
  } else {
    expect(host.close).not.toThrow();
    expect(destroyGuest).not.toThrow();
  }
  expect(guest.eventNames()).toEqual([]);
  expect(host.dispose).not.toThrow();
});
