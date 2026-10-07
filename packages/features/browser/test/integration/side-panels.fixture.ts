import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, session, webContents, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { verifyNavigationTargets } from './navigation.fixture.js';

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  browserSession.protocol.handle('https', () => new Response('<!doctype html><title>Browser tab</title>', { headers: { 'Content-Type': 'text/html' } }));
  const owner = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'navigation.cjs'), webviewTag: true, contextIsolation: true, sandbox: true } });
  const other = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'navigation.cjs'), webviewTag: true, contextIsolation: true, sandbox: true } });
  const service = new BrowserExtensionService({ session: browserSession, preloadPath: path.join(directory, 'actions.cjs'),
    owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner
      : contents.hostWebContents?.id === other.webContents.id ? other : null,
    activeOwner: () => owner, windows: () => [owner, other], language: () => 'en-US',
    publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined });
  const id = await writeExtension(browserSession.storagePath!);
  const cleanup = [owner, other].map((window) => installEmbeddedBrowserWebviews({ mainWindow: window,
    interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: () => null, contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: (url) => service.allowsPage(url), onGuestAttached: (contents) => service.track(contents),
    onNewTabRequested: (contents, url) => service.requestNavigationTarget(contents, url) }));
  try {
    await service.start();
    const primary = await createGuest(owner, 'https://example.test/');
    const foreign = await createGuest(other, 'https://foreign.test/');
    assert.equal(service.list().find((extension) => extension.id === id)?.hasPopup, false);
    assert.equal(service.list().find((extension) => extension.id === id)?.hasSidePanel, true);
    assert.equal(await service.open(id, 'action', owner, undefined, primary.id), true);
    const panel = await until(() => service.ui.panels.snapshot(owner, primary.id), 'worker opens panel from onClicked');
    assert.equal(panel.id, id);
    assert.equal(service.ui.panels.snapshot(other, foreign.id), null);
    const contents = await createGuest(owner, panel.url);
    await until(() => contents.executeJavaScript('document.body.dataset.ready'), 'extension panel scripts run');
    const secondTab = await createGuest(owner, 'https://example.test/second');
    await contents.executeJavaScript('chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})');
    assert.equal(await service.open(id, 'action', owner, undefined, secondTab.id), true);
    assert.equal(service.ui.panels.snapshot(owner), null, 'global action closes the panel after switching tabs');
    assert.equal(await service.open(id, 'action', owner, undefined, primary.id), true);
    assert.ok(service.ui.panels.snapshot(owner));
    await contents.executeJavaScript('chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false})');
    const result = await contents.executeJavaScript(`(async () => {
      const current = await chrome.windows.getCurrent();
      const clicks = await chrome.storage.local.get('clickedTab');
      const failures = [];
      for (const input of [{path:'https://example.test/'}, {path:'chrome-extension://${'b'.repeat(32)}/private.html'}, {tabId:999999, enabled:true}]) {
        try { await chrome.sidePanel.setOptions(input); } catch { failures.push(true); }
      }
      try { await chrome.sidePanel.open({tabId:${primary.id}, windowId:${other.id}}); } catch { failures.push(true); }
      await chrome.sidePanel.setOptions({tabId:${primary.id}, path:'specific.html', enabled:true});
      const callbackError = await new Promise(resolve => chrome.sidePanel.getOptions({tabId:999999}, () => resolve(chrome.runtime.lastError?.message)));
      return { current:current.id, clicked:clicks.clickedTab, denied:failures.length,
        callbackError, desktop:typeof window.setsunaDesktop,
        global:await chrome.sidePanel.getOptions({}), tab:await chrome.sidePanel.getOptions({tabId:${primary.id}}) };
    })()`);
    assert.equal(result.current, owner.id);
    assert.equal(result.clicked.id, primary.id); assert.equal(result.clicked.windowId, owner.id);
    assert.equal(result.denied, 4); assert.equal(result.global.path, 'panel.html'); assert.equal(result.tab.path, 'specific.html');
    assert.equal(result.callbackError, 'Browser tab unavailable.'); assert.equal(result.desktop, 'undefined');
    assert.equal(await primary.executeJavaScript('typeof chrome.sidePanel'), 'undefined');
    await foreign.loadURL('https://foreign.test/updated');
    const updated = await until(() => contents.executeJavaScript(`chrome.storage.local.get('updatedTab')
      .then(data => data.updatedTab?.id === ${foreign.id} && data.updatedTab.tab.url === 'https://foreign.test/updated' && data.updatedTab)`),
    'navigation event from the other window');
    assert.equal(updated.tab.windowId, other.id);
    await verifySystemApis(service, contents, primary, owner);
    await verifyNavigationTargets(service, contents, primary, owner, other);

    assert.equal(await service.open(id, 'action', other, undefined, foreign.id), true);
    await until(() => service.ui.panels.snapshot(other, foreign.id), 'second window opens its own panel');
    assert.equal(await contents.executeJavaScript('chrome.windows.getCurrent().then(window => window.id)'), owner.id);
    app.emit('browser-window-focus', {} as Electron.Event, owner);
    assert.equal(await contents.executeJavaScript('chrome.windows.getLastFocused().then(window => window.id)'), owner.id);
    app.emit('browser-window-focus', {} as Electron.Event, other);
    assert.equal(await contents.executeJavaScript('chrome.windows.getLastFocused().then(window => window.id)'), other.id);
    assert.equal(await contents.executeJavaScript('chrome.windows.getCurrent().then(window => window.id)'), owner.id);
    service.ui.panels.close(other);
    await until(() => service.ui.panels.snapshot(owner, primary.id)?.url.endsWith('/specific.html'), 'panel path switches');
    assert.equal(service.ui.panels.snapshot(owner, foreign.id), null);
    await contents.executeJavaScript(`chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`);
    assert.equal(await service.open(id, 'action', owner, undefined, primary.id), true);
    assert.equal(service.ui.panels.snapshot(owner, primary.id), null);
    assert.equal(await service.open(id, 'action', owner, undefined, primary.id), true);
    assert.ok(service.ui.panels.snapshot(owner, primary.id));
    await verifyPanelHost(service, other, id);
    assert.equal(await service.setEnabled(id, false), true);
    assert.equal(service.ui.panels.snapshot(owner, primary.id), null);
    assert.equal(await service.open(id, 'action', owner, undefined, primary.id), false);
    if (process.env.SETSUNA_SIDEPANEL_EXTENSION_DIRECTORY) {
      await verifyInstalledExtension(service, owner, primary);
    }
    console.log('EXTENSION_SIDEPANEL_OK');
  } finally {
    for (const dispose of cleanup) dispose();
    service.dispose(); owner.destroy(); other.destroy();
  }
}

async function createGuest(owner: BrowserWindow, url: string): Promise<WebContents> {
  const attached = new Promise<WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
  if (!owner.webContents.getURL()) await owner.loadURL('data:text/html,<!doctype html><body></body>');
  await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
    view.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)}); view.setAttribute('allowpopups', ''); view.src = ${JSON.stringify(url)};
    document.body.appendChild(view); })()`);
  const contents = await attached;
  await until(() => !contents.isLoading() && contents.getURL() === url, 'guest loads');
  return contents;
}

async function verifySystemApis(service: BrowserExtensionService, panel: WebContents, primary: WebContents, owner: BrowserWindow): Promise<void> {
  const result = await panel.executeJavaScript(`(async () => {
    const targets = await chrome.debugger.getTargets();
    const denied = [];
    for (const tabId of [${owner.webContents.id}, ${panel.id}]) {
      try { await chrome.debugger.attach({tabId}, '1.3'); } catch { denied.push(tabId); }
    }
    await chrome.debugger.attach({tabId:${primary.id}}, '1.3');
    const value = await chrome.debugger.sendCommand({tabId:${primary.id}}, 'Runtime.evaluate', {expression:'6*7', returnByValue:true});
    try { await chrome.debugger.sendCommand({tabId:${primary.id}}, 'Target.getTargets'); } catch { denied.push('global'); }
    try { await chrome.debugger.sendCommand({tabId:${primary.id}}, 'Page.navigate', {url:'file:///private/host'}); } catch { denied.push('file'); }
    const detached = new Promise(resolve => chrome.debugger.onDetach.addListener((source, reason) => resolve({source,reason})));
    await chrome.debugger.detach({tabId:${primary.id}});
    const frames = await chrome.webNavigation.getAllFrames({tabId:${primary.id}});
    const nativeFailure = await new Promise(resolve => {
      const port = chrome.runtime.connectNative('org.setsuna.test_missing_host');
      port.onDisconnect.addListener(() => resolve(chrome.runtime.lastError?.message));
    });
    const lastErrorAfterDisconnect = chrome.runtime.lastError;
    await new Promise(resolve => chrome.contextMenus.create({id:'ask', title:'Ask', contexts:['page']}, resolve));
    return {targetIds:targets.map(target => target.tabId), denied:denied.length, value:value.result.value,
      detached:await detached, frames, nativeFailure, lastErrorAfterDisconnect};
  })()`);
  assert.ok(result.targetIds.includes(primary.id)); assert.ok(!result.targetIds.includes(owner.webContents.id));
  assert.ok(!result.targetIds.includes(panel.id)); assert.equal(result.denied, 4); assert.equal(result.value, 42);
  assert.equal(result.detached.source.tabId, primary.id); assert.equal(result.frames[0].frameId, 0);
  assert.equal(result.nativeFailure, 'Specified native messaging host not found.'); assert.equal(result.lastErrorAfterDisconnect, undefined);
  const entries = service.contextMenuItems(primary, { pageURL: primary.getURL(), frameURL: primary.getURL(),
    mediaType: 'none', selectionText: '', isEditable: false } as Electron.ContextMenuParams);
  assert.equal(entries.length, 1); entries[0].click?.();
  const clicked = await until(() => panel.executeJavaScript('chrome.storage.local.get("menuClick").then(value=>value.menuClick)'), 'context menu event reaches worker');
  assert.equal(clicked.info.menuItemId, 'ask'); assert.equal(clicked.tab.id, primary.id);
}

async function writeExtension(storagePath: string): Promise<string> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const root = path.join(storagePath, 'Extensions', id, '1.0.0_0'); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ key: key.toString('base64'), manifest_version: 3,
    name: 'Side panel fixture', version: '1.0.0', permissions: ['storage', 'tabs', 'sidePanel', 'debugger', 'contextMenus', 'webNavigation', 'nativeMessaging'], action: {},
    side_panel: { default_path: 'panel.html' }, background: { service_worker: 'worker.js' } }));
  // Keep registration in flight while the worker evaluates its startup code.
  // Opening a default panel must not stand in for delivering the first action click.
  await writeFile(path.join(root, 'worker.js'), `const started = Date.now(); while (Date.now() - started < 1000) {}
  chrome.action.onClicked.addListener(async (tab) => {
    await chrome.storage.local.set({clickedTab:tab}); await chrome.sidePanel.open({tabId:tab.id});
  }); chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false});
  chrome.contextMenus.onClicked.addListener((info, tab) => chrome.storage.local.set({menuClick:{info,tab}}));
  chrome.tabs.onUpdated.addListener((id, changeInfo, tab) => chrome.storage.local.set({updatedTab:{id,changeInfo,tab}}));
  const navigationTargets = [];
  chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
    navigationTargets.push(details); chrome.storage.local.set({navigationTargets});
  });
  chrome.runtime.onConnect.addListener(port => port.onMessage.addListener(message => port.postMessage(message)));`);
  for (const name of ['panel.html', 'specific.html']) await writeFile(path.join(root, name), '<!doctype html><body><textarea></textarea><div style="height:1600px"></div><script src="panel.js"></script>');
  await writeFile(path.join(root, 'panel.js'), `document.body.dataset.ready = "yes";
    window.fixturePort = chrome.runtime.connect({name:'retained'});
    window.fixturePort.onMessage.addListener(message => document.body.dataset.portAnswer = message);
    window.fixturePort.onDisconnect.addListener(() => document.body.dataset.disconnected = 'true');`);
  return id;
}

async function verifyPanelHost(service: BrowserExtensionService, owner: BrowserWindow, id: string): Promise<void> {
  const extension = session.fromPartition(DESKTOP_BROWSER_PARTITION).extensions.getExtension(id)!;
  assert.equal(service.ui.panels.show(extension, owner), true);
  const configuration = { extension: service.list().find((extension) => extension.id === id), panel: service.ui.panels.snapshot(owner) };
  const html = path.join(directory, 'panel-host.html');
  await writeFile(html, `<!doctype html><link rel="stylesheet" href="panel-host.css"><style>body{margin:0}</style><div id="root"></div>
    <script>window.configuration=${JSON.stringify(configuration)}</script><script src="panel-host.js"></script>`);
  let attachments = 0;
  const count = () => attachments++;
  owner.webContents.on('did-attach-webview', count);
  const attached = new Promise<WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
  try {
    await owner.loadFile(html);
    const guest = await attached;
    const guestId = guest.id;
    await until(() => guest.executeJavaScript('document.body.dataset.ready'), 'window panel loads');
    await guest.executeJavaScript(`document.querySelector('textarea').value = 'unsaved draft'; window.retained = 42;
      window.scrollTo(0, 200); window.fixturePort.postMessage('before-switch');`);
    await until(() => guest.executeJavaScript('document.body.dataset.portAnswer === "before-switch"'), 'panel port connects');
    const scroll = await guest.executeJavaScript('window.scrollY');
    for (const selection of ['second', null, 'first', 'second']) {
      await owner.webContents.executeJavaScript(`window.panelFixture.select(${JSON.stringify(selection)})`);
      assert.equal(webContents.fromId(guestId), guest);
      assert.deepEqual(await guest.executeJavaScript(`({ draft:document.querySelector('textarea').value, retained:window.retained, scroll:window.scrollY })`),
        { draft: 'unsaved draft', retained: 42, scroll });
    }
    await owner.webContents.executeJavaScript('window.panelFixture.removeFirst()');
    assert.equal(webContents.fromId(guestId), guest);
    await guest.executeJavaScript(`window.fixturePort.postMessage('after-switch')`);
    await until(() => guest.executeJavaScript('document.body.dataset.portAnswer === "after-switch"'), 'panel port survives switching and removal');
    assert.equal(await guest.executeJavaScript('document.body.dataset.disconnected'), undefined);
    assert.equal(attachments, 1);
    await owner.webContents.executeJavaScript('window.panelFixture.close()');
    await until(() => guest.isDestroyed(), 'explicit close destroys the guest');
    const reopened = new Promise<WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript('window.panelFixture.reopen()');
    const fresh = await reopened;
    await until(() => fresh.executeJavaScript('document.body.dataset.ready'), 'reopened panel loads');
    assert.notEqual(fresh.id, guestId);
    assert.equal(await fresh.executeJavaScript('document.querySelector("textarea").value'), '');
  } finally { owner.webContents.off('did-attach-webview', count); service.ui.panels.close(owner); }
}

async function verifyInstalledExtension(service: BrowserExtensionService, owner: BrowserWindow, primary: WebContents): Promise<void> {
  const location = process.env.SETSUNA_SIDEPANEL_EXTENSION_DIRECTORY!;
  const manifest = JSON.parse(await readFile(path.join(location, 'manifest.json'), 'utf8'));
  const key = Buffer.from(manifest.key, 'base64');
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  assert.equal(await service.importInstallation({ id, manifest, name: manifest.name, version: manifest.version, path: location }, true, new AbortController().signal), true);
  assert.equal(await service.open(id, 'action', owner, undefined, primary.id), true);
  const panel = await until(() => {
    const snapshot = service.ui.panels.snapshot(owner, primary.id);
    return snapshot?.id === id ? snapshot : null;
  }, 'installed extension opens its side panel');
  const contents = await createGuest(owner, panel.url);
  await until(() => contents.executeJavaScript('Boolean(document.querySelector("#root")?.childElementCount && document.body.textContent.trim())'), 'installed extension application renders');
  const status = await contents.executeJavaScript(`(async () => {
    const info = await Promise.race([chrome.runtime.sendMessage({type:'ensure_codex_app_server', windowId:${owner.id}}),
      new Promise((resolve) => setTimeout(() => resolve({ok:false, error:'App server startup timed out.'}), 10000))]);
    return {ok:info?.ok, sidePanelOpen:info?.sidePanelOpen, error:info?.error, errorCode:info?.errorCode,
      hostState:info?.nativeHostStatus?.state, hostError:info?.nativeHostStatus?.error, reason:info?.connectionFailureReason};
  })()`);
  assert.equal(status.ok, true, `Installed extension app server unavailable: ${JSON.stringify(status)}`);
  await until(() => contents.executeJavaScript(`Boolean(document.querySelector('textarea, [contenteditable="true"]'))`), 'installed extension chat composer connects');
  console.log(`INSTALLED_SIDEPANEL_OPEN_OK ${id}`);
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
