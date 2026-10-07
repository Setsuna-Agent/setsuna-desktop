import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value as NonNullable<T>;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  browserSession.protocol.handle('https', request => new Response(`<!doctype html><title>Private ${new URL(request.url).hostname}</title><body>page</body>`,
    { headers: { 'Content-Type': 'text/html' } }));
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const other = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const service = new BrowserExtensionService({ session: browserSession, preloadPath: path.join(directory, 'actions.cjs'),
    owner: contents => contents.hostWebContents?.id === owner.webContents.id ? owner
      : contents.hostWebContents?.id === other.webContents.id ? other : null,
    activeOwner: () => owner, windows: () => [owner, other], language: () => 'en-US',
    publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined });
  const first = await writeExtension(browserSession.storagePath!);
  const second = await writeExtension(browserSession.storagePath!);
  const cleanup = [owner, other].map(window => installEmbeddedBrowserWebviews({ mainWindow: window,
    interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: () => null, contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: url => service.allowsPage(url), onGuestAttached: contents => service.track(contents) }));
  try {
    await service.start();
    const primary = await createGuest(owner, 'https://example.test/');
    const sibling = await createGuest(owner, 'https://example.test/sibling');
    const foreign = await createGuest(other, 'https://example.test/foreign');
    let control = await createGuest(owner, `chrome-extension://${first}/control.html`);
    const unrelated = await createGuest(owner, `chrome-extension://${second}/control.html`);
    await assert.rejects(inject(control, primary.id), /Cannot access contents/);
    assert.equal(await service.open(first, 'action', owner, undefined, foreign.id), true);
    await assert.rejects(inject(control, foreign.id), /Cannot access contents/);
    assert.equal(await service.open(first, 'action', owner, undefined, primary.id), true);
    const clicked = await until(() => control.executeJavaScript('chrome.runtime.sendMessage({readClick:true})'), 'action injection returns');
    assert.equal(clicked.error, undefined, JSON.stringify(clicked));
    assert.equal(clicked.tab.url, primary.getURL()); assert.equal(clicked.tab.windowId, owner.id);
    assert.equal(clicked.result[0].result, 42); assert.equal(clicked.result[0].frameId, 0);
    assert.match(clicked.result[0].documentId, /^[a-f0-9-]+$/);
    assert.equal(await primary.executeJavaScript('window.activeTabValue'), undefined, 'isolated execution does not leak globals to the page');
    await assert.rejects(inject(unrelated, primary.id), /Cannot access contents/);
    await assert.rejects(inject(control, sibling.id), /Cannot access contents/);
    await verifyPopupGrant(service, unrelated, second, primary, owner);
    const main = await control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${primary.id}},world:'MAIN',func:() => window.activeTabValue = 7})`);
    assert.equal(main[0].result, 7); assert.equal(await primary.executeJavaScript('window.activeTabValue'), 7);
    const files = await control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${primary.id}},files:['first.js','second.js']})`);
    assert.equal(files[0].result, 43, 'file sources share the extension world and run in order');
    const callback = await control.executeJavaScript(`new Promise(resolve => chrome.scripting.executeScript({target:{tabId:${primary.id}},func:() => 44}, result => resolve({result,error:chrome.runtime.lastError?.message})))`);
    assert.equal(callback.error, undefined); assert.equal(callback.result[0].result, 44);
    await assert.rejects(control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${primary.id}},files:['../private.js']})`), /Could not load/);

    await primary.executeJavaScript(`(() => { for (const src of ['https://example.test/frame','https://other.test/frame']) {
      const frame = document.createElement('iframe'); frame.src = src; document.body.appendChild(frame); } })()`);
    const frames = await until(() => {
      const children = primary.mainFrame.framesInSubtree.filter(frame => frame.parent !== null);
      return children.length === 2 && children.every(frame => frame.url.endsWith('/frame')) ? children : null;
    }, 'child frames load');
    const same = frames.find(frame => frame.origin === primary.mainFrame.origin)!;
    const cross = frames.find(frame => frame.origin !== primary.mainFrame.origin)!;
    const targeted = await control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${primary.id},frameIds:[${same.frameTreeNodeId}]},func:() => location.hostname})`);
    assert.equal(targeted[0].result, 'example.test'); assert.equal(targeted[0].frameId, same.frameTreeNodeId);
    await assert.rejects(control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${primary.id},frameIds:[${cross.frameTreeNodeId}]},func:() => location.hostname})`), /Cannot access contents/);
    const originalDocument = (await inject(control, primary.id))[0].documentId;
    await primary.loadURL('https://example.test/next');
    const retained = await inject(control, primary.id);
    assert.equal(retained[0].result, 42); assert.notEqual(retained[0].documentId, originalDocument);
    await primary.executeJavaScript("history.pushState({},'', '/spa#hash')");
    assert.equal((await inject(control, primary.id))[0].result, 42);
    await primary.loadURL('https://other.test/');
    await assert.rejects(inject(control, primary.id), /Cannot access contents/);
    await primary.loadURL('https://example.test/');
    await assert.rejects(inject(control, primary.id), /Cannot access contents/);
    await service.open(first, 'action', owner, undefined, primary.id);
    assert.equal((await inject(control, primary.id))[0].result, 42);
    assert.equal(await service.setEnabled(first, false), true);
    assert.equal(await service.setEnabled(first, true), true);
    control = await createGuest(owner, `chrome-extension://${first}/control.html`);
    await assert.rejects(inject(control, primary.id), /Cannot access contents/);
    await service.open(first, 'action', owner, undefined, primary.id);
    assert.equal((await inject(control, primary.id))[0].result, 42);
    const closedId = primary.id;
    await owner.webContents.executeJavaScript(`document.querySelector('webview[data-id="${closedId}"]').remove()`);
    await until(() => primary.isDestroyed(), 'tab closes');
    await assert.rejects(inject(control, closedId));
    console.log('EXTENSION_ACTIVE_TAB_OK');
  } finally { for (const dispose of cleanup) dispose(); service.dispose(); owner.destroy(); other.destroy(); }
}

async function inject(control: WebContents, tabId: number): Promise<Array<{ frameId: number; documentId: string; result: unknown }>> {
  return control.executeJavaScript(`chrome.scripting.executeScript({target:{tabId:${tabId}},func:(a,b) => a+b,args:[20,22]})`);
}

async function verifyPopupGrant(service: BrowserExtensionService, control: WebContents, id: string, target: WebContents, owner: BrowserWindow) {
  const root = target.session.extensions.getExtension(id)!.path;
  await writeFile(path.join(root, 'popup.html'), '<!doctype html><body><script src="popup.js"></script></body>');
  await writeFile(path.join(root, 'popup.js'), `chrome.scripting.executeScript({target:{tabId:${target.id}},func:() => 45})
    .then(value => document.body.dataset.result = value[0].result, error => document.body.dataset.error = error.message);`);
  await control.executeJavaScript("chrome.action.setPopup({popup:'popup.html'})");
  await until(() => service.actions.snapshot(target.id).find(action => action.id === id)?.popup?.endsWith('/popup.html'), 'popup override arrives');
  assert.equal(await service.open(id, 'action', owner, undefined, target.id), true);
  const popup = await until(() => BrowserWindow.getAllWindows().find(window => window.getParentWindow() === owner
    && window.webContents.getURL() === `chrome-extension://${id}/popup.html`), 'action popup opens');
  await until(() => popup.webContents.executeJavaScript('document.body.dataset.result || document.body.dataset.error'), 'popup injects on startup');
  assert.equal(await popup.webContents.executeJavaScript('document.body.dataset.result'), '45');
  popup.destroy();
}

async function createGuest(owner: BrowserWindow, url: string): Promise<WebContents> {
  const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
  if (!owner.webContents.getURL()) await owner.loadURL('data:text/html,<!doctype html><body></body>');
  await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
    view.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)}); view.src = ${JSON.stringify(url)}; document.body.appendChild(view); })()`);
  const contents = await attached;
  await until(() => !contents.isLoading() && contents.getURL() === url, 'guest loads');
  await owner.webContents.executeJavaScript(`document.querySelector('webview:last-child').dataset.id = '${contents.id}'`);
  return contents;
}

async function writeExtension(storagePath: string): Promise<string> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const root = path.join(storagePath, 'Extensions', id, '1.0.0_0'); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ key: key.toString('base64'), manifest_version: 3,
    name: 'Active tab fixture', version: '1.0.0', permissions: ['activeTab', 'scripting'], action: {}, background: { service_worker: 'worker.js' } }));
  await writeFile(path.join(root, 'worker.js'), `let clicked;
    chrome.action.onClicked.addListener(async tab => {
      try { clicked = {tab,result:await chrome.scripting.executeScript({target:{tabId:tab.id},func:async (a,b) => window.activeTabValue = a+b,args:[20,22]})}; }
      catch(error) { clicked = {error:error.message}; }
    });
    chrome.runtime.onMessage.addListener((message,_sender,respond) => { if(message.readClick) respond(clicked ?? null); });`);
  await writeFile(path.join(root, 'control.html'), '<!doctype html><body>control</body>');
  await writeFile(path.join(root, 'first.js'), 'window.activeTabValue = 42;');
  await writeFile(path.join(root, 'second.js'), 'window.activeTabValue += 1;');
  return id;
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
