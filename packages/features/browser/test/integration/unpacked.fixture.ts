import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { app, BrowserWindow, session, webContents } from 'electron';
import { provideHostCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import { DESKTOP_BROWSER_PARTITION, type BrowserExtensionInstallResult } from '../../src/contracts/index.js';
import { browserMainFeature } from '../../src/main/feature.js';
import { browserControlConnectionCapability, browserMainHostCapability } from '../../src/main/capabilities.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { BrowserRuntimeTools } from '../../src/runtime/browser-runtime-tools.js';
import { HttpBrowserControlClient } from '../../src/runtime/http-browser-control-client.js';

const directory = process.argv[2]; const phase = process.argv[3];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
BrowserWindow.prototype.showInactive = () => undefined;

async function until(read: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function backgroundFor(id: string): Promise<Electron.WebContents> {
  let background: Electron.WebContents | undefined;
  await until(() => Boolean(background = webContents.getAllWebContents().find(contents =>
    contents.getType() === 'backgroundPage' && contents.getURL().startsWith(`chrome-extension://${id}/`))), 'MV2 background creation');
  return background!;
}

async function sourceExtension(name: string, version: number, broken = false) {
  const source = path.join(directory, name); await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ manifest_version: version, name, version: '1.2.3',
    permissions: version === 2 ? ['storage', 'tabs', 'contextMenus', 'privacy', 'webNavigation', 'webRequest', 'webRequestBlocking', 'http://127.0.0.1/*'] : ['storage'],
    ...(version === 2 ? { background: { scripts: ['background.js'] }, browser_action: { default_popup: 'popup.html' }, options_page: 'options.html' } : {}),
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: [broken ? 'missing.js' : 'content.js'] }],
  }));
  await writeFile(path.join(source, 'content.js'), `document.documentElement.dataset.localV${version} = 'yes';`);
  if (version === 2) {
    await writeFile(path.join(source, 'background.js'), `chrome.webRequest.onBeforeRequest.addListener(
      () => ({ cancel: true }), { urls: ['http://127.0.0.1/*blocked*'] }, ['blocking']);
      globalThis.startupCount = 0;
      chrome.runtime.onStartup.addListener(() => { globalThis.startupCount++; });
      chrome.browserAction.setTitle({ title: 'Local MV2 ready' });
      chrome.webNavigation.onCommitted.addListener(details => {
        if (details.frameId === 0) chrome.storage.local.set({ committed: details });
      });
      chrome.runtime.onMessage.addListener((message, _sender, reply) => {
        if (message !== 'popup-data') return;
        chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => reply(tabs[0]));
        return true;
      });
      chrome.privacy.network.networkPredictionEnabled.set({ value: false }, () => {
        chrome.storage.local.set({ privacyError: chrome.runtime.lastError?.message });
      });`);
    await writeFile(path.join(source, 'popup.html'), '<script src="popup.js"></script><body></body>');
    await writeFile(path.join(source, 'options.html'), '<!doctype html><title>Extension options</title>');
    await writeFile(path.join(source, 'popup.js'), `chrome.runtime.sendMessage('popup-data').then(tab => {
      document.body.dataset.tabId = tab.id; document.body.dataset.url = tab.url;
    });`);
  }
  return source;
}

async function main() {
  await app.whenReady();
  const server = http.createServer((_request, response) => { response.end('<!doctype html><title>Local extension fixture</title>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true,
    preload: path.join(directory, 'browser.cjs') } });
  const otherOwner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true,
    preload: path.join(directory, 'browser.cjs') } });
  let extensions!: BrowserExtensionService;
  const start = BrowserExtensionService.prototype.start;
  BrowserExtensionService.prototype.start = function () { extensions = this; return start.call(this); };
  const composition = await defineMainFeatureHost({ required: [browserMainFeature], optional: [] }).activate({ hostCapabilities: [
    provideHostCapability(browserMainHostCapability, {
      extensionPreloadPath: path.join(directory, 'actions.cjs'),
      passwordStorage: { read: async () => null, write: async () => undefined },
      // The real host falls back to its first desktop window when a popup has focus.
      focusedWindow: () => owner, onWindowAdded: (listener) => {
        const first = listener(owner); const second = listener(otherOwner);
        return () => { first(); second(); };
      },
      activeKeyboardShortcutBindings: () => new Set(), interfaceLanguage: () => 'en-US',
    }),
  ] });
  try {
    const { connection } = composition.resolveHostDependencies({ connection: requiredCapability(browserControlConnectionCapability) });
    const tools = new BrowserRuntimeTools(new HttpBrowserControlClient(connection.url, connection.token));
    const context = { environment: { id: 'local', cwd: directory, workspaceRoot: directory, workspaceRoots: [directory] } };
    const install = async (source: string) => (await tools.runTool('browser_install_extension', { directory: source }, context)).data as BrowserExtensionInstallResult;
    const installedRoot = path.join(browser.storagePath!, 'Extensions');
    let ids: { v2: string; v3: string };
    if (phase === 'install') {
      const v2 = await sourceExtension('Local v2', 2); const v3 = await sourceExtension('Local v3', 3);
      assert.deepEqual(await extensions.installUnpacked(v2, new AbortController().signal, async () => false), { status: 'cancelled' });
      assert.deepEqual(await readdir(installedRoot), []);
      const result2 = await install(v2); assert.equal(result2.status, 'installed');
      const result3 = await extensions.installUnpacked(v3, new AbortController().signal, async (snapshot) => {
        assert.deepEqual(snapshot.manifest.permissions, ['storage']);
        await writeFile(path.join(v3, 'content.js'), 'throw new Error("changed after consent");');
        await writeFile(path.join(v3, 'manifest.json'), JSON.stringify({ ...snapshot.manifest, host_permissions: ['<all_urls>'] }));
        return true;
      });
      assert.equal(result3.status, 'installed');
      if (result2.status !== 'installed' || result3.status !== 'installed') throw new Error('Missing installation results');
      ids = { v2: result2.extension.id, v3: result3.extension.id };
      assert.deepEqual(result3.extension.hostPermissions, []);
      assert.deepEqual(await install(v2), { kind: 'extension-install', status: 'failed', reason: 'already-installed' });
      await writeFile(path.join(directory, 'ids.json'), JSON.stringify(ids));
      await rm(v2, { recursive: true, force: true }); await rm(v3, { recursive: true, force: true });
      const broken = await sourceExtension('Broken extension', 3, true);
      assert.deepEqual(await install(broken), { kind: 'extension-install', status: 'failed', reason: 'load-failed' });
      assert.deepEqual((await readdir(installedRoot)).sort(), [ids.v2, ids.v3].sort());
    } else {
      ids = JSON.parse(await readFile(path.join(directory, 'ids.json'), 'utf8'));
      await extensions.start();
      assert.equal(extensions.list().find(({ id }) => id === ids.v2)?.enabled, true);
      assert.equal(extensions.list().find(({ id }) => id === ids.v3)?.enabled, false);
      assert.equal(browser.extensions.getExtension(ids.v3), null);
      assert.equal(await extensions.setEnabled(ids.v3, true), true);
    }
    const list = await tools.runTool('browser_extensions', {}, context);
    assert.deepEqual((list.data as { extensions: { id: string }[] }).extensions.map(({ id }) => id).sort(), [ids.v2, ids.v3].sort());
    const attached = new Promise<Electron.WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="${url}"></webview>`);
    const guest = await attached;
    await until(() => guest.executeJavaScript('document.documentElement.dataset.localV2 === "yes" && document.documentElement.dataset.localV3 === "yes"'), 'native MV2 and MV3 content scripts');
    assert.equal(await owner.webContents.executeJavaScript('navigationFixture.setActiveTab("first")'), true);
    await otherOwner.loadURL('data:text/html,<body>Other desktop</body>');
    await otherOwner.webContents.executeJavaScript('navigationFixture.setActiveTab(null)');
    assert.equal(await owner.webContents.executeJavaScript(`navigationFixture.registerTab('first', ${guest.id})`), true);
    const background = await backgroundFor(ids.v2);
    const expectedStartups = phase === 'restore' ? 1 : 0;
    await until(() => background.executeJavaScript(`globalThis.startupCount === ${expectedStartups}`), 'one MV2 profile startup on restore only');
    const backgroundActiveIds = (query: Record<string, unknown>) => background.executeJavaScript(
      `chrome.tabs.query(${JSON.stringify({ active: true, ...query })}).then(tabs => tabs.map(tab => tab.id))`);
    assert.deepEqual(await backgroundActiveIds({ windowId: owner.id }), [guest.id]);
    assert.equal(await guest.executeJavaScript('fetch("/allowed").then(() => true, () => false)'), true);
    await until(() => guest.executeJavaScript('fetch("/blocked").then(() => false, () => true)'), 'MV2 background request blocking');
    assert.equal(await extensions.open(ids.v2, 'popup', owner, undefined, guest.id), true);
    const popup = BrowserWindow.getAllWindows().find(window => window.getParentWindow() === owner)!;
    await until(() => popup.webContents.executeJavaScript(`document.body.dataset.tabId === '${guest.id}'
      && document.body.dataset.url === ${JSON.stringify(url)}`), 'MV2 popup targets the browser tab');
    const stored = await popup.webContents.executeJavaScript('chrome.storage.local.get(["committed", "privacyError"])');
    assert.equal(stored.committed.tabId, guest.id); assert.equal(stored.committed.url, url);
    assert.match(stored.privacyError, /Unsupported extension browser API/);
    assert.equal(await popup.webContents.executeJavaScript('chrome.browserAction.getTitle({})'), 'Local MV2 ready');

    assert.equal(await extensions.open(ids.v2, 'options', owner), true);
    const optionsUrl = `chrome-extension://${ids.v2}/options.html`;
    const options = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === optionsUrl)!;
    const created = await popup.webContents.executeJavaScript('chrome.tabs.create({ url: chrome.runtime.getURL("options.html"), active: false })');
    const createdContents = webContents.fromId(created.id)!;
    for (const document of [options.webContents, createdContents]) {
      const nativeTab = await document.executeJavaScript(`chrome.tabs.get(${document.id})`);
      for (const query of [{ url: optionsUrl, currentWindow: true },
        { url: optionsUrl, currentWindow: true, active: nativeTab.active, highlighted: nativeTab.highlighted },
        { url: optionsUrl, windowId: nativeTab.windowId }, { url: optionsUrl, active: !nativeTab.active }]) {
        const results = await document.executeJavaScript(`(async () => {
          const project = tabs => tabs.map(({ id, windowId, active, highlighted, url, title }) => ({ id, windowId, active, highlighted, url, title }));
          return { native: project(await nativeTabQueryFixture(${JSON.stringify(query)})),
            compatible: project(await chrome.tabs.query(${JSON.stringify(query)})) };
        })()`);
        assert.deepEqual(results.compatible, results.native);
        if (query.active === undefined) assert.equal(results.compatible.some((tab: { id: number }) => tab.id === document.id), true);
      }
    }
    await popup.webContents.executeJavaScript(`chrome.tabs.remove(${created.id})`);
    options.destroy();

    const secondAttached = new Promise<Electron.WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript(`(() => {
      const view = document.createElement('webview'); view.setAttribute('partition', '${DESKTOP_BROWSER_PARTITION}');
      view.src = '${url}second'; document.body.appendChild(view);
    })()`);
    const second = await secondAttached;
    await until(() => second.executeJavaScript('document.documentElement.dataset.localV2 === "yes"'), 'second browser guest');
    assert.equal(await owner.webContents.executeJavaScript(`navigationFixture.registerTab('second', ${second.id})`), true);
    // Native extension documents remain queryable alongside the host's guests.
    // These assertions concern the two managed browser pages only.
    const guestIds = (active: boolean) => popup.webContents.executeJavaScript(`chrome.tabs.query({ active: ${active}, currentWindow: true })
      .then(tabs => tabs.filter(tab => [${guest.id}, ${second.id}].includes(tab.id)).map(tab => tab.id))`);
    const activeIds = () => guestIds(true);
    const inactiveIds = () => guestIds(false);
    assert.deepEqual(await activeIds(), [guest.id]);
    assert.deepEqual(await inactiveIds(), [second.id]);
    assert.equal(await popup.webContents.executeJavaScript(`chrome.tabs.get(${guest.id}).then(tab => tab.active)`), true);
    assert.equal(await popup.webContents.executeJavaScript(`chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.id === ${guest.id}).active)`), true);
    // Switching through the desktop bridge must work without focusing the new guest
    // or reopening the popup with a new action-click hint.
    assert.equal(await owner.webContents.executeJavaScript('navigationFixture.setActiveTab("second")'), true);
    assert.deepEqual(await activeIds(), [second.id]);
    assert.deepEqual(await inactiveIds(), [guest.id]);
    assert.equal(await popup.webContents.executeJavaScript(`chrome.tabs.get(${guest.id}).then(tab => tab.active)`), false);
    assert.equal(await popup.webContents.executeJavaScript(`chrome.tabs.get(${second.id}).then(tab => tab.active)`), true);
    const tabs = (await tools.runTool('browser_tabs', {}, context)).data as { tabs: { id: string; active: boolean }[] };
    assert.equal(tabs.tabs.find(tab => tab.active)?.id, 'second');
    assert.equal(await owner.webContents.executeJavaScript('navigationFixture.setActiveTab(null)'), true);
    assert.deepEqual(await activeIds(), []);
    assert.deepEqual((await inactiveIds()).sort(), [guest.id, second.id].sort());
    await owner.webContents.executeJavaScript('navigationFixture.setActiveTab("second")');
    await owner.webContents.executeJavaScript(`navigationFixture.unregisterTab('second', ${second.id})`);
    assert.deepEqual(await activeIds(), []);

    const otherAttached = new Promise<Electron.WebContents>(resolve => otherOwner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await otherOwner.webContents.executeJavaScript(`(() => {
      const view = document.createElement('webview'); view.setAttribute('partition', '${DESKTOP_BROWSER_PARTITION}');
      view.src = '${url}other'; document.body.appendChild(view);
    })()`);
    const otherGuest = await otherAttached;
    await until(() => otherGuest.executeJavaScript('document.documentElement.dataset.localV2 === "yes"'), 'other desktop guest');
    await otherOwner.webContents.executeJavaScript(`navigationFixture.registerTab('other', ${otherGuest.id})`);
    await otherOwner.webContents.executeJavaScript('navigationFixture.setActiveTab("other")');
    await owner.webContents.executeJavaScript('navigationFixture.setActiveTab("first")');
    app.emit('browser-window-focus', {} as Electron.Event, owner);
    assert.equal(await extensions.open(ids.v2, 'popup', otherOwner, undefined, otherGuest.id), true);
    const otherPopup = BrowserWindow.getAllWindows().find(window => window.getParentWindow() === otherOwner)!;
    app.emit('browser-window-focus', {} as Electron.Event, otherPopup);
    assert.equal(await otherPopup.webContents.executeJavaScript('chrome.windows.getLastFocused().then(window => window.id)'), otherOwner.id);
    assert.equal(await background.executeJavaScript('chrome.windows.getCurrent().then(window => window.id)'), otherOwner.id);
    assert.equal(await background.executeJavaScript('chrome.windows.get(-2).then(window => window.id)'), otherOwner.id);
    for (const query of [{ lastFocusedWindow: true }, { currentWindow: true }, { windowId: -2 }]) {
      assert.deepEqual(await backgroundActiveIds(query), [otherGuest.id]);
    }
    assert.deepEqual(await activeIds(), [guest.id]);
    const focusedTabs = (await tools.runTool('browser_tabs', {}, context)).data as { tabs: { id: string; active: boolean }[] };
    assert.equal(focusedTabs.tabs.find(tab => tab.active)?.id, 'other');
    otherPopup.destroy();
    otherOwner.destroy();
    assert.deepEqual(await backgroundActiveIds({ lastFocusedWindow: true }), [guest.id]);
    popup.destroy();
    assert.equal(await background.executeJavaScript('globalThis.startupCount'), expectedStartups);
    if (phase === 'install') {
      assert.equal(await extensions.setEnabled(ids.v3, false), true);
      const cancelledSource = await sourceExtension('Cancelled extension', 3);
      const nativeLoad = browser.extensions.loadExtension.bind(browser.extensions);
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const loading = new Promise<void>(resolve => { entered = resolve; });
      browser.extensions.loadExtension = async (...args) => { const extension = await nativeLoad(...args); entered(); await gate; return extension; };
      const abort = new AbortController();
      const pending = extensions.installUnpacked(cancelledSource, abort.signal);
      await loading; abort.abort();
      assert.deepEqual(await pending, { status: 'cancelled' });
      assert.deepEqual(await extensions.installUnpacked(cancelledSource, new AbortController().signal), { status: 'failed', reason: 'installation-pending' });
      release(); await new Promise(resolve => setImmediate(resolve));
      browser.extensions.loadExtension = nativeLoad;
      const retry = await extensions.installUnpacked(cancelledSource, new AbortController().signal);
      assert.equal(retry.status, 'installed');
      if (retry.status !== 'installed') throw new Error('Missing retry result');
      assert.equal(browser.extensions.getExtension(retry.extension.id)?.id, retry.extension.id);
      assert.equal(await extensions.remove(retry.extension.id), true);
      assert.deepEqual((await readdir(installedRoot)).sort(), [ids.v2, ids.v3].sort());
      assert.deepEqual(browser.extensions.getAllExtensions().map(({ id }) => id), [ids.v2]);
      assert.equal(await extensions.setEnabled(ids.v2, false), true);
      assert.equal(await extensions.setEnabled(ids.v2, true), true);
      const reenabled = await backgroundFor(ids.v2);
      await until(() => reenabled.executeJavaScript('globalThis.startupCount === 0'), 'reenabling MV2 does not emit profile startup');
    } else {
      assert.equal(await extensions.remove(ids.v2), true); assert.equal(await extensions.remove(ids.v3), true);
      assert.deepEqual(await readdir(installedRoot), []);
    }
    console.log(`UNPACKED_${phase.toUpperCase()}_OK`);
  } finally {
    await composition.dispose(); owner.destroy(); if (!otherOwner.isDestroyed()) otherOwner.destroy(); server.close();
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
