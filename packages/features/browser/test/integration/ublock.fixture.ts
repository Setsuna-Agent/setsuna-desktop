import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, session, webContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';

const directory = process.argv[2]; const source = process.argv[3];
let stage = 'startup';
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await read(); if (result) return result as NonNullable<T>;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  // A native page evaluation can hang without settling its Promise. Report the
  // operation before the parent process timeout terminates this isolated profile.
  const timeout = setTimeout(() => { console.error(`uBlock fixture timed out during ${stage}`); app.exit(1); }, 20_000);
  await app.whenReady();
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url!); response.end('<!doctype html><title>uBlock native fixture</title><body>Local page</body>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true } });
  const service = new BrowserExtensionService({ session: browser, preloadPath: path.join(directory, 'actions.cjs'),
    owner: contents => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    activeOwner: () => owner, windows: () => [owner], language: () => 'en-US',
    actionsChanged: () => undefined, publish: () => undefined, openWebPage: () => undefined });
  const errors: string[] = [];
  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_event, _file, error) => errors.push(error.message));
    contents.on('console-message', event => { if (/Uncaught/.test(event.message)) errors.push(event.message); });
  });
  try {
    stage = 'installation';
    await service.start();
    const installed = await service.installUnpacked(source, new AbortController().signal);
    assert.equal(installed.status, 'installed');
    if (installed.status !== 'installed') throw new Error('uBlock installation failed');
    assert.equal(installed.extension.name, 'uBlock Origin');
    stage = 'filtering engine startup';
    await until(async () => {
      // uBlock restarts its background on first installation while migrating settings.
      const background = webContents.getAllWebContents().find(contents =>
        contents.getURL() === `chrome-extension://${installed.extension.id}/background.html`);
      if (!background) return false;
      let cancelled!: () => void;
      const replaced = new Promise<boolean>(resolve => { cancelled = () => resolve(false); });
      const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (event.isMainFrame && !event.isSameDocument) cancelled();
      };
      background.once('destroyed', cancelled).on('did-start-navigation', navigating);
      try {
        // Electron can leave executeJavaScript pending when uBlock restarts the
        // background. Retry against the replacement rather than awaiting the old VM.
        return await Promise.race([replaced, background.executeJavaScript(
          `import(chrome.runtime.getURL('js/background.js')).then(module => module.default.readyToFilter)`)]);
      }
      catch (error) { if (background.isDestroyed()) return false; throw error; }
      finally { background.off('destroyed', cancelled).off('did-start-navigation', navigating); }
    }, 'uBlock filtering engine');
    const attached = new Promise<Electron.WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => {
      service.track(contents); resolve(contents);
    }));
    stage = 'browser page loading';
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="${url}"></webview>`);
    const guest = await attached;
    await until(() => guest.getURL() === url && !guest.isLoadingMainFrame(), 'browser page');
    assert.equal(await service.open(installed.extension.id, 'popup', owner, undefined, guest.id), true, 'original uBlock popup opens');
    stage = 'popup communication';
    const popup = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/popup-fenix.html'))!;
    const data = await until(() => popup.webContents.executeJavaScript(`globalThis.vAPI?.messaging?.send('popupPanel', { what: 'getPopupData', tabId: null })`), 'original popup communication');
    assert.equal(data.tabId, guest.id); assert.equal(data.tabTitle, 'uBlock native fixture');
    stage = 'page context';
    // Native guest webRequest IDs can be -1. Read page context only after its host
    // navigation arrives; this test proves interception, without claiming per-tab counts.
    await until(() => popup.webContents.executeJavaScript(`vAPI.messaging.send('popupPanel', { what: 'getPopupData', tabId: ${guest.id} }).then(data => data.pageURL === ${JSON.stringify(url)})`), 'uBlock page context');
    stage = 'user filter write';
    await popup.webContents.executeJavaScript(`vAPI.messaging.send('dashboard', { what: 'writeUserFilters', enabled: true,
      trusted: false, content: ${JSON.stringify('||127.0.0.1^$xmlhttprequest\n@@/allowed$xmlhttprequest')} })`);
    stage = 'filter reload';
    await popup.webContents.executeJavaScript(`vAPI.messaging.send('dashboard', { what: 'reloadAllFilters' })`);
    stage = 'request interception';
    assert.equal(await guest.executeJavaScript('fetch("/setsuna-blocked").then(() => false, () => true)'), true, 'filter blocks a native request');
    assert.equal(requests.includes('/setsuna-blocked'), false);
    assert.equal(await guest.executeJavaScript('fetch("/allowed").then(() => true, () => false)'), true);
    assert.equal(requests.includes('/allowed'), true);
    assert.deepEqual(errors, []);
    console.log(`UBLOCK_${installed.extension.version}_OK`);
  } finally {
    clearTimeout(timeout);
    service.dispose(); owner.destroy(); server.close();
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
