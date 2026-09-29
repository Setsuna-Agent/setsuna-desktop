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

function windowFixture() {
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
    browserTabIdForWebContents: () => null,
    interfaceLanguage: () => 'zh-CN',
    contextMenus: new BrowserContextMenuSession(vi.fn()),
  });
  window.once('closed', dispose);
  return { contents, dispose, close: () => {
    destroyed = true;
    contents.emit('destroyed');
    window.emit('closed');
  } };
}

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
