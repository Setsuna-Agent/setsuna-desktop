import assert from 'node:assert/strict';
import path from 'node:path';
import { app, BrowserWindow, session, type FindInPageOptions, type Result, type WebContents } from 'electron';
import { BROWSER_IPC_CHANNELS, DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function until(read: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the native page-find shortcut');
}

function find(contents: WebContents, text: string, options: FindInPageOptions): Promise<Result> {
  return new Promise((resolve, reject) => {
    let last: Result | null = null;
    const timer = setTimeout(() => { contents.off('found-in-page', found); reject(new Error(`Timed out finding ${text}, request ${requestId}, last result ${JSON.stringify(last)}`)); }, 5_000);
    const found = (_event: Electron.Event, result: Result) => {
      last = result;
      if (result.requestId !== requestId || !result.finalUpdate) return;
      contents.off('found-in-page', found);
      clearTimeout(timer);
      resolve(result);
    };
    contents.on('found-in-page', found);
    const requestId = contents.findInPage(text, options);
  });
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  browserSession.protocol.handle('https', () => new Response('<!doctype html><title>Page find</title><p>Alpha</p><p>Beta Alpha</p>', {
    headers: { 'Content-Type': 'text/html' },
  }));
  // Chromium searches painted frames; offscreen rendering keeps this functional test hidden.
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const stop = installEmbeddedBrowserWebviews({
    mainWindow: owner, interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(['Control+KeyF', 'Meta+KeyF']),
    browserTabIdForWebContents: () => 'test-tab', contextMenus: {} as BrowserContextMenuSession,
  });
  const published: Array<{ channel: string; tabId: unknown }> = [];
  const send = owner.webContents.send.bind(owner.webContents);
  owner.webContents.send = (channel, ...args) => { published.push({ channel, tabId: args[0] }); send(channel, ...args); };
  try {
    const attached = new Promise<WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview style="display:flex;width:800px;height:600px" partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    guest.setBackgroundThrottling(false);
    await guest.loadURL('https://find.example.test/');
    assert.equal(await guest.executeJavaScript('document.body.textContent'), 'AlphaBeta Alpha');
    for (const [index, modifiers] of [['control'], ['meta']].entries()) {
      guest.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers });
      guest.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers });
      await until(() => published.length === index + 1);
    }
    assert.deepEqual(published, [
      { channel: BROWSER_IPC_CHANNELS.findInPageRequested, tabId: 'test-tab' },
      { channel: BROWSER_IPC_CHANNELS.findInPageRequested, tabId: 'test-tab' },
    ]);
    const first = await find(guest, 'Alpha', { findNext: true });
    assert.equal(first.matches, 2);
    assert.equal(first.activeMatchOrdinal, 1);
    const next = await find(guest, 'Alpha', { findNext: false, forward: true });
    assert.equal(next.activeMatchOrdinal, 2);
    const previous = await find(guest, 'Alpha', { findNext: false, forward: false });
    assert.equal(previous.activeMatchOrdinal, 1);
    guest.stopFindInPage('clearSelection');
    assert.equal((await find(guest, 'missing', { findNext: true })).matches, 0);
    guest.stopFindInPage('clearSelection');
    console.log('FIND_OK');
  } finally { stop(); owner.destroy(); }
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
