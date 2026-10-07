import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
BrowserWindow.prototype.showInactive = () => undefined;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<T> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  let pendingRequested: () => void = () => undefined;
  const downloadServer = createServer((request, response) => {
    if (request.url === '/pending') { pendingRequested(); return; }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.txt"' });
    response.end('download');
  });
  await new Promise<void>((resolve) => downloadServer.listen(0, '127.0.0.1', resolve));
  const downloadAddress = downloadServer.address();
  assert.ok(downloadAddress && typeof downloadAddress !== 'string');
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const installation = path.join(browserSession.storagePath!, 'Extensions', id, '1.0_0');
  await mkdir(installation, { recursive: true });
  await writeFile(path.join(installation, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'User scripts fixture', version: '1.0', key: key.toString('base64'), permissions: ['storage', 'userScripts', 'webNavigation'],
    host_permissions: ['https://example.test/*'], background: { service_worker: 'worker.js' },
  }));
  await writeFile(path.join(installation, 'worker.js'), `
    let allowed = false; try { allowed = !!chrome.userScripts; } catch {}
    chrome.storage.local.set({ startup: Date.now(), allowed });
    const urlChanges = [];
    chrome.tabs.onUpdated.addListener((id, changeInfo, tab) => {
      const key = changeInfo.status === 'complete' ? 'lastTab' : changeInfo.status === 'loading' ? 'lastLoadingTab' : 'lastUrlChange';
      if (!changeInfo.status) urlChanges.push({ id, changeInfo, tab });
      chrome.storage.local.set({ [key]: { id, changeInfo, tab }, urlChanges });
    });
    chrome.tabs.onRemoved.addListener((id, removeInfo) => chrome.storage.local.set({ removedTab: { id, removeInfo } }));
    chrome.runtime.onMessage.addListener((request, _sender, respond) => {
      if (request.kind === 'frames') {
        chrome.webNavigation.getAllFrames({ tabId: request.tabId }).then(result => respond({ result })); return true;
      }
      if (request.kind === 'tabs-api') {
        (async () => { try { respond({ result: await chrome.tabs[request.method](...request.args) }); }
          catch (error) { respond({ error: error.message }); } })(); return true;
      }
      if (request.kind !== 'api') return;
      (async () => { try { respond({ result: await chrome.userScripts[request.method](...request.args) }); }
        catch (error) { respond({ error: error.message }); } })(); return true;
    });
    chrome.runtime.onUserScriptMessage?.addListener((message, sender, respond) => respond({ echo: message, tab: sender.tab.id, frame: sender.frameId }));
    chrome.runtime.onUserScriptConnect?.addListener((port) => {
      port.onMessage.addListener((message) => port.postMessage({ echo: message }));
      if (port.name === 'persistent') port.onDisconnect.addListener(() => chrome.storage.local.set({ disconnectedFrame: port.sender.frameId }));
    });
  `);
  await writeFile(path.join(installation, 'control.html'), '<!doctype html><title>Control</title>');
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const service = new BrowserExtensionService({
    preloadPath: path.join(directory, 'extensions.cjs'), session: browserSession,
    owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    activeOwner: () => owner,
    language: () => 'en-US', publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined,
  });
  const stopWebviews = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US',
    activeKeyboardShortcutBindings: () => new Set(), browserTabIdForWebContents: () => 'test-tab', contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: (url) => service.allowsPage(url), onGuestAttached: (contents) => service.track(contents),
  });
  browserSession.protocol.handle('https', (request) => new Response(`<!doctype html><title>Test</title><div id="result"></div>${new URL(request.url).pathname === '/frame' ? '' : '<iframe src="https://example.test/frame"></iframe>'}`, { headers: { 'Content-Type': 'text/html' } }));
  const control = new BrowserWindow({ show: false, webPreferences: { session: browserSession, contextIsolation: true, sandbox: true } });
  try {
    await service.start();
    await control.loadURL(`chrome-extension://${id}/control.html`);
    assert.equal(await control.webContents.executeJavaScript('typeof chrome.userScripts'), 'undefined');
    assert.equal(await service.setUserScriptsAllowed(id, true), true);
    await control.loadURL(`chrome-extension://${id}/control.html`);
    await until(() => control.webContents.executeJavaScript('!!chrome.userScripts'), 'permission bootstrap');
    const api = async (method: string, args: unknown[] = []) => {
      const answer = await control.webContents.executeJavaScript(`chrome.runtime.sendMessage(${JSON.stringify({ kind: 'api', method, args })})`);
      if (answer?.error) throw new Error(answer.error);
      return answer?.result;
    };
    const tabsApi = (method: string, args: unknown[]) => control.webContents.executeJavaScript(
      `chrome.runtime.sendMessage(${JSON.stringify({ kind: 'tabs-api', method, args })})`);
    const created = (await tabsApi('create', [{ url: `chrome-extension://${id}/control.html` }])).result;
    const documentWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.id === created.id)!;
    assert.ok(documentWindow);
    assert.equal(documentWindow.webContents.session, browserSession);
    assert.equal(created.windowId, owner.id);
    assert.equal((await tabsApi('remove', [created.id])).error, undefined);
    await until(() => documentWindow.isDestroyed(), 'extension closes its created document');
    for (const url of [`chrome-extension://${'b'.repeat(32)}/control.html`, 'file:///private/secret', 'javascript:alert(1)']) {
      assert.ok((await tabsApi('create', [{ url }])).error);
    }
    assert.ok((await tabsApi('remove', [owner.webContents.id])).error);
    assert.equal(owner.isDestroyed(), false);
    await api('configureWorld', [{ csp: "script-src 'self' 'unsafe-eval'; object-src 'self'", messaging: true }]);
    await api('register', [[{ id: 'test', matches: ['https://example.test/*'], excludeMatches: ['https://example.test/excluded*'], allFrames: true, runAt: 'document_start', js: [{ code: `
      document.documentElement.dataset.scriptStart = document.readyState;
      chrome.runtime.sendMessage('hello').then((answer) => document.documentElement.dataset.message = JSON.stringify(answer));
      const port = chrome.runtime.connect({ name: 'test' });
      port.onMessage.addListener((answer) => { document.documentElement.dataset.port = JSON.stringify(answer); port.disconnect(); }); port.postMessage('port');
      const persistentPort = chrome.runtime.connect({ name: 'persistent' });
      persistentPort.onMessage.addListener((answer) => { document.documentElement.dataset.persistentPort = JSON.stringify(answer); });
      persistentPort.onDisconnect.addListener(() => { document.documentElement.dataset.disconnected = 'true'; });
      document.addEventListener('request-script-port', () => persistentPort.postMessage(location.hash));
      chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message.kind === 'frame-race') {
          if (location.pathname === message.winner) { respond({ frame: location.pathname }); return; }
          document.documentElement.dataset.waitingReply = 'true';
          return true;
        }
        if (message === 'no-response') return;
        respond({ page: message });
      });
      document.addEventListener('request-script-message', () => chrome.runtime.sendMessage('after-hash').then((answer) => document.documentElement.dataset.message = JSON.stringify(answer)));
    ` }] }]]);
    const attached = new Promise<Electron.WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    await guest.loadURL('https://example.test/');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastTab')
      .then(data => data.lastTab?.id === ${guest.id} && data.lastTab.tab.url === 'https://example.test/')`), 'worker receives the guest navigation');
    assert.equal(await control.webContents.executeJavaScript("chrome.storage.local.get('lastTab').then(data => data.lastTab.tab.windowId)"), owner.id);
    await until(() => guest.executeJavaScript('document.documentElement.dataset.port'), 'userscript port');
    const result = await guest.executeJavaScript('({...document.documentElement.dataset})');
    assert.ok(['loading', 'interactive'].includes(result.scriptStart));
    assert.deepEqual(JSON.parse(result.message), { echo: 'hello', tab: guest.id, frame: 0 });
    assert.deepEqual(JSON.parse(result.port), { echo: 'port' });
    const child = guest.mainFrame.framesInSubtree.find((frame) => frame.parent !== null && frame.url.endsWith('/frame'))!;
    await until(() => child.executeJavaScript('document.documentElement.dataset.message'), 'iframe messaging');
    const childId = JSON.parse(await child.executeJavaScript('document.documentElement.dataset.message')).frame;
    const frames = (await control.webContents.executeJavaScript(`chrome.runtime.sendMessage({ kind: 'frames', tabId: ${guest.id} })`)).result;
    assert.equal(frames.find((frame: { url: string }) => frame.url.endsWith('/frame')).frameId, childId);
    assert.equal(frames.find((frame: { frameId: number }) => frame.frameId === childId).parentFrameId, 0);
    const targeted = await api('execute', [{ target: { tabId: guest.id, frameIds: [childId] }, js: [{ code: 'location.pathname' }], injectImmediately: true }]);
    assert.deepEqual(targeted.map((item: { frameId: number; result: unknown }) => ({ frameId: item.frameId, result: item.result })), [{ frameId: childId, result: '/frame' }]);
    assert.deepEqual(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'iframe-message', { frameId: ${childId} })`), { page: 'iframe-message' });
    for (const winner of ['/', '/frame']) {
      const reply = await control.webContents.executeJavaScript(`(async () => {
        let timer;
        try { return await Promise.race([
          chrome.tabs.sendMessage(${guest.id}, {kind:'frame-race', winner:${JSON.stringify(winner)}}),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A silent frame blocked the responding frame.')), 3000); })
        ]); } finally { clearTimeout(timer); }
      })()`);
      assert.deepEqual(reply, { frame: winner });
    }
    assert.equal(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'no-response').then(() => false, () => true)`), true);
    await child.executeJavaScript('location.hash = "child-route"');
    // A child frame route must not be reported as the top-level tab's URL.
    await guest.executeJavaScript('history.pushState({}, "", "/spa-route")');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastUrlChange')
      .then(data => data.lastUrlChange?.id === ${guest.id} && data.lastUrlChange.changeInfo.url === 'https://example.test/spa-route'
        && data.lastUrlChange.tab.url === 'https://example.test/spa-route' && data.lastUrlChange.tab.windowId === ${owner.id}
        && !('status' in data.lastUrlChange.changeInfo))`), 'pushState URL update');
    await guest.executeJavaScript('location.hash = "same-document"; document.dispatchEvent(new Event("request-script-message"))');
    await until(() => guest.executeJavaScript('document.documentElement.dataset.message.includes("after-hash")'), 'same-document script context');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastUrlChange')
      .then(data => data.lastUrlChange?.changeInfo.url === 'https://example.test/spa-route#same-document')`), 'hash URL update');
    assert.deepEqual(await control.webContents.executeJavaScript(`chrome.storage.local.get('urlChanges')
      .then(data => data.urlChanges.filter(change => change.id === ${guest.id}).map(change => change.changeInfo.url))`),
    ['https://example.test/spa-route', 'https://example.test/spa-route#same-document']);
    await child.executeJavaScript('delete document.documentElement.dataset.waitingReply');
    await control.webContents.executeJavaScript(`globalThis.removedFrameReply = chrome.tabs.sendMessage(${guest.id},
      {kind:'frame-race', winner:'/missing'}, {frameId:${childId}}).then(() => 'unexpected response', error => error.message); void 0`);
    await until(() => child.executeJavaScript('document.documentElement.dataset.waitingReply'), 'iframe holds a pending delivery');
    await guest.executeJavaScript('document.querySelector("iframe").remove()');
    await until(() => child.isDestroyed(), 'removed iframe destruction');
    // No API request should be needed to release the removed document's ports.
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('disconnectedFrame')
      .then(data => data.disconnectedFrame === ${childId})`), 'removed iframe disconnects its persistent port');
    assert.match(await control.webContents.executeJavaScript('globalThis.removedFrameReply'), /Receiving end does not exist/);
    assert.deepEqual(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'after-frame-removal')`), { page: 'after-frame-removal' });
    assert.equal(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'removed-frame', {frameId:${childId}}).then(() => false, () => true)`), true);
    assert.equal(await guest.executeJavaScript('typeof chrome?.runtime'), 'undefined');
    const execute = () => api('execute', [{ target: { tabId: guest.id }, js: [{ code: '6 * 7' }], injectImmediately: true }]);
    const before = await execute();
    assert.deepEqual(before.map((item: { result: unknown }) => item.result), [42]);
    assert.deepEqual(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'tab-message')`), { page: 'tab-message' });
    const downloaded = new Promise<void>((resolve, reject) => browserSession.once('will-download', (_event, item) => {
      item.setSavePath(path.join(directory, 'fixture.txt'));
      item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(`Download ${state}`)));
    }));
    await guest.loadURL(`http://127.0.0.1:${downloadAddress.port}/fixture.txt`).catch(() => undefined);
    await downloaded;
    assert.deepEqual(await execute(), before);
    await guest.executeJavaScript('document.dispatchEvent(new Event("request-script-message")); document.dispatchEvent(new Event("request-script-port"))');
    await until(() => guest.executeJavaScript('document.documentElement.dataset.persistentPort'), 'port survives download');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.disconnected'), undefined);
    assert.deepEqual(await control.webContents.executeJavaScript(`chrome.tabs.sendMessage(${guest.id}, 'after-download')`), { page: 'after-download' });
    const requested = new Promise<void>((resolve) => { pendingRequested = resolve; });
    const cancelled = guest.loadURL(`http://127.0.0.1:${downloadAddress.port}/pending`)
      .then(() => false, () => true);
    await requested;
    guest.stop();
    assert.equal(await cancelled, true);
    assert.deepEqual(await execute(), before);
    await guest.loadURL('https://example.test/');
    assert.notEqual((await execute())[0].documentId, before[0].documentId);
    await until(() => guest.executeJavaScript('document.documentElement.dataset.port'), 'new document messaging context');
    await guest.loadURL('https://example.test/excluded');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.scriptStart'), undefined);
    await guest.loadURL('https://ungranted.test/');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.scriptStart'), undefined);
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastTab')
      .then(data => data.lastTab?.id === ${guest.id} && !('url' in data.lastTab.tab) && !('url' in data.lastTab.changeInfo))`),
    'navigation events hide a website without an access grant');
    await control.webContents.executeJavaScript('chrome.storage.local.remove("lastUrlChange")');
    await guest.executeJavaScript('history.pushState({}, "", "/private-route#secret")');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastUrlChange')
      .then(data => data.lastUrlChange?.id === ${guest.id} && !('url' in data.lastUrlChange.tab)
        && !('url' in data.lastUrlChange.changeInfo) && !('title' in data.lastUrlChange.tab))`),
    'same-document events do not leak an ungranted URL');
    await guest.loadURL('https://example.test/');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('lastLoadingTab')
      .then(data => data.lastLoadingTab?.id === ${guest.id} && data.lastLoadingTab.tab.pendingUrl === 'https://example.test/'
        && !('url' in data.lastLoadingTab.tab) && !('title' in data.lastLoadingTab.tab))`),
    'a granted destination does not expose the previous ungranted document');
    await service.setUserScriptsAllowed(id, false);
    await until(() => control.webContents.executeJavaScript(`(() => {
      if (!chrome.userScripts) throw new Error('The existing namespace must survive revocation.');
      try { chrome.userScripts.getScripts(); return false; }
      catch (error) { return error.message.includes('Allow user scripts'); }
    })()`), 'revoked methods reject synchronously');
    await guest.loadURL('https://example.test/');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.scriptStart'), undefined);
    await service.setUserScriptsAllowed(id, true);
    await control.loadURL(`chrome-extension://${id}/control.html`);
    await until(() => control.webContents.executeJavaScript('!!chrome.userScripts'), 'restored control');
    assert.equal((await api('getScripts')).length, 1);
    assert.match(await control.webContents.executeJavaScript('new Promise(resolve => chrome.userScripts.register([{ id: "_invalid", matches: ["<all_urls>"], js: [{code:"1"}] }], () => resolve(chrome.runtime.lastError?.message)))'), /must not start/);
    await guest.reload();
    await until(() => guest.executeJavaScript('document.documentElement.dataset.port'), 'restored registration');
    const guestId = guest.id;
    await owner.webContents.executeJavaScript('document.querySelector("webview").remove()');
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('removedTab')
      .then(data => data.removedTab?.id === ${guestId} && data.removedTab.removeInfo.windowId === ${owner.id})`), 'removed tab keeps its window ownership');
    await service.remove(id);
    assert.equal(service.list().length, 0);
    console.log('USER_SCRIPTS_OK');
  } finally { downloadServer.closeAllConnections(); downloadServer.close(); service.dispose(); stopWebviews(); owner.destroy(); control.destroy(); }
}
main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
