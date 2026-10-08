import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, dialog, nativeImage, session, type Extension, type Session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BROWSER_BOOKMARKS_CHANGED, BROWSER_BOOKMARKS_STORAGE_KEY } from '../../src/contracts/bookmarks.js';
import { BOOKMARK_BAR_ID, emptyBookmarkTree } from '../../src/contracts/bookmark-tree.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { extensionPageUrl } from '../../src/main/extensions/metadata.js';
import { startExtensionWorker } from '../../src/main/extensions/worker-startup.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { registerExtensionFaviconScheme } from '../../src/main/extensions/favicons.js';

registerExtensionFaviconScheme();
const directory = process.argv[2]; const phase = process.argv[3];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
BrowserWindow.prototype.showInactive = () => undefined;
let approved = true; let confirmations = 0;
dialog.showMessageBox = (async () => { confirmations++; return { response: approved ? 1 : 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await read(); if (result) return result as NonNullable<T>;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function control(browser: Session, owner: BrowserWindow, extension: Extension): Promise<WebContents> {
  const window = new BrowserWindow({ parent: owner, show: false,
    webPreferences: { session: browser, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadURL(extensionPageUrl(extension, 'popup') ?? extensionPageUrl(extension, 'newtab')!);
  return window.webContents;
}

function invoke(contents: WebContents, method: string, args: unknown[] = []): Promise<unknown> {
  return contents.executeJavaScript(`chrome.runtime.sendMessage(${JSON.stringify({ method, args })}).then(reply => {
    if (!reply.ok) throw new Error(reply.error); return reply.result;
  })`);
}

async function main() {
  await app.whenReady();
  const browser = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  // Tests use copied installations and an isolated profile. No original worker can contact a real service.
  const icon = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }).toPNG();
  browser.protocol.handle('https', async request => {
    if (new URL(request.url).pathname === '/favicon.ico') {
      // Keep image reads in flight so a real batch exceeds the host's concurrency limit.
      await new Promise(resolve => setTimeout(resolve, 30));
      return new Response(new Uint8Array(icon), { headers: { 'Content-Type': 'image/png' } });
    }
    if (new URL(request.url).hostname === 'private.test') return new Response('<!doctype html><title>Private tab</title>',
      { headers: { 'Content-Type': 'text/html' } });
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  browser.protocol.handle('http', request => new URL(request.url).hostname === '127.0.0.1'
    ? new Response('<!doctype html><title>Static webpage</title><body>Fixture</body>', { headers: { 'Content-Type': 'text/html' } })
    : new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  const page = path.join(directory, 'desktop.html');
  await writeFile(page, '<!doctype html><title>Desktop bookmark owner</title>');
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  await owner.loadFile(page);
  const tree = { version: 2, nodes: [...emptyBookmarkTree().nodes,
    { id: 'existing', parentId: BOOKMARK_BAR_ID, type: 'bookmark', title: 'Shared bookmark', url: 'https://shared.test/', dateAdded: 1 }] };
  await owner.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(tree))});
    window.bookmarkNotifications = 0; window.addEventListener(${JSON.stringify(BROWSER_BOOKMARKS_CHANGED)}, () => window.bookmarkNotifications++);`);
  if (phase.startsWith('originals')) {
    for (const source of process.argv.slice(4)) {
      const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
      const id = extensionId(Buffer.from(manifest.key, 'base64'));
      const target = path.join(browser.storagePath!, 'Extensions', id, `${manifest.version}_0`);
      await mkdir(path.dirname(target), { recursive: true }); await cp(source, target, { recursive: true });
    }
  } else if (phase === 'grant') {
    const first = await writeExtension(browser.storagePath!, ['cookies', 'storage', 'bookmarks', 'notifications'], [], ['https://*.allowed.test/*']);
    const second = await writeExtension(browser.storagePath!, ['cookies', 'storage'], ['https://only.allowed.test/*'], []);
    await writeFile(path.join(directory, 'ids.json'), JSON.stringify([first, second]));
  }
  const service = new BrowserExtensionService({ session: browser, preloadPath: path.join(directory, 'extensions.cjs'),
    owner: contents => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    activeOwner: () => owner, windows: () => [owner], language: () => 'en-US',
    publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined });
  const nativeEmitWarning = process.emitWarning;
  try {
    await service.start();
    if (phase.startsWith('originals')) {
      await checkOriginals(browser, owner, service);
    } else {
      const [first, second] = JSON.parse(await readFile(path.join(directory, 'ids.json'), 'utf8')) as string[];
      const full = await control(browser, owner, browser.extensions.getExtension(first)!);
      const restricted = await control(browser, owner, browser.extensions.getExtension(second)!);
      await until(() => full.executeJavaScript(`chrome.storage.local.get('startupCount').then(value => value.startupCount === ${phase === 'grant' ? 1 : 2})`), 'profile startup event');
      await until(() => restricted.executeJavaScript(`chrome.storage.local.get('startupCount').then(value => value.startupCount === ${phase === 'grant' ? 1 : 2})`), 'second profile startup event');
      await browser.cookies.set({ url: 'https://only.allowed.test/account/', name: 'same', value: 'root', secure: true, path: '/' });
      await browser.cookies.set({ url: 'https://only.allowed.test/account/', name: 'same', value: 'specific', secure: true, path: '/account' });
      await browser.cookies.set({ url: 'https://secret.test/', name: 'secret', value: 'browser secret', secure: true });
      await session.defaultSession.cookies.set({ url: 'https://only.allowed.test/', name: 'desktop', value: 'desktop secret', secure: true });
      if (phase === 'grant') {
        assert.equal(await full.executeJavaScript('typeof chrome.sidePanel'), 'object');
        await assert.rejects(full.executeJavaScript('chrome.sidePanel.getOptions({})'), /sidePanel permission required/);
        await assert.rejects(invoke(full, 'sidePanel.getOptions', [{}]), /sidePanel permission required/);
        assert.equal(await full.executeJavaScript(`fetch(chrome.runtime.getURL('/_favicon/') + '?pageUrl=https%3A%2F%2Fonly.allowed.test&size=32').then(response=>response.status)`), 403);
        assert.deepEqual(await invoke(full, 'cookies.getAll', [{}]), []);
        await assert.rejects(invoke(full, 'permissions.request', [{ origins: ['https://secret.test/*'] }]), /not declared/);
        assert.equal(confirmations, 0);
        approved = false;
        assert.equal(await invoke(full, 'permissions.request', [{ origins: ['https://only.allowed.test/*'] }]), false);
        approved = true;
        assert.equal(await full.executeJavaScript(`chrome.permissions.request({origins:['https://only.allowed.test/*'],
          permissions:['tabs','favicon','sidePanel','contextMenus']})`), true);
        assert.equal(confirmations, 2);
        const state = JSON.parse(await readFile(path.join(browser.storagePath!, 'extensions-state.json'), 'utf8'));
        assert.deepEqual(state.optionalPermissions[first].origins, ['https://only.allowed.test/*']);
        assert.equal(await invoke(restricted, 'permissions.contains', [{ permissions: ['tabs'] }]), false);
        await until(async () => (await invoke(full, 'events') as Array<{ kind: string }>).some(event => event.kind === 'permissionsAdded'), 'worker permission event');
      } else {
        assert.equal(await invoke(full, 'permissions.contains', [{ origins: ['https://only.allowed.test/*'], permissions: ['tabs', 'favicon', 'sidePanel', 'contextMenus'] }]), true);
        assert.equal(confirmations, 0);
      }
      assert.deepEqual(await full.executeJavaScript('chrome.sidePanel.getOptions({})'), { enabled: false });
      assert.deepEqual(await invoke(full, 'sidePanel.getOptions', [{}]), { enabled: false });
      await verifyOptionalMenus(full, restricted, service, owner);
      const favicon = await full.executeJavaScript(`fetch(chrome.runtime.getURL('/_favicon/') + '?pageUrl=https%3A%2F%2Fonly.allowed.test&size=32').then(async response => ({
        type: response.headers.get('content-type'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())), url: response.url
      }))`) as { type: string; bytes: number[]; url: string };
      assert.equal(favicon.type, 'image/png'); assert.deepEqual(favicon.bytes.slice(0, 4), [137, 80, 78, 71]);
      assert.equal(await invoke(full, 'favicon'), 'image/png');
      const forged = new URL(favicon.url); forged.pathname = '/forged/';
      assert.equal(await full.executeJavaScript(`fetch(${JSON.stringify(forged.href)}).then(response => response.status)`), 403);
      await full.executeJavaScript(`(() => { const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "img-src 'self'"; document.head.appendChild(policy); })()`);
      assert.equal(await full.executeJavaScript(`new Promise(resolve => { const icon = new Image();
        icon.onload = () => resolve(icon.naturalWidth > 0); icon.onerror = () => resolve(false);
        icon.src = chrome.runtime.getURL('/_favicon/') + '?pageUrl=https%3A%2F%2Fonly.allowed.test&size=32'; })`), true);
      const batch = await full.executeJavaScript(`Promise.all(Array.from({length:40}, (_, index) => new Promise(resolve => {
        const icon = new Image(); icon.onload = () => resolve(icon.naturalWidth > 0); icon.onerror = () => resolve(false);
        icon.src = chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent('https://icon-' + index + '.test/') + '&size=32';
      })))`) as boolean[];
      assert.equal(batch.length, 40); assert.equal(batch.every(Boolean), true);
      assert.equal(await service.setEnabled(second, false), true); assert.equal(await service.setEnabled(second, true), true);
      const reloaded = await control(browser, owner, browser.extensions.getExtension(second)!);
      assert.equal(await reloaded.executeJavaScript(`chrome.storage.local.get('startupCount').then(value => value.startupCount)`), phase === 'grant' ? 1 : 2);
      const cookies = await invoke(full, 'cookies.getAll', [{}]) as Array<{ name: string; value: string; storeId: string }>;
      assert.equal(cookies.some(cookie => cookie.name === 'secret' || cookie.name === 'desktop'), false);
      assert.equal(cookies.every(cookie => cookie.storeId === '0'), true);
      const selected = await invoke(full, 'cookies.get', [{ url: 'https://only.allowed.test/account/', name: 'same' }]) as { value: string };
      assert.equal(selected.value, 'specific');
      await assert.rejects(invoke(full, 'cookies.getAll', [{ storeId: '1' }]), /Unknown cookie store/);
      await invoke(full, 'cookies.remove', [{ url: 'https://only.allowed.test/account/', name: 'same' }]);
      assert.deepEqual((await browser.cookies.get({ name: 'same' })).map(cookie => cookie.path), ['/']);
      const created = await invoke(full, 'cookies.set', [{ url: 'https://only.allowed.test/', name: 'created', value: 'real', secure: true, sameSite: 'strict' }]) as { value: string; sameSite: string };
      assert.equal(created.value, 'real'); assert.equal(created.sameSite, 'strict');
      for (const domain of [undefined, '.only.allowed.test']) {
        const scoped = await invoke(full, 'cookies.set', [{ url: 'https://only.allowed.test/', name: 'created', value: 'scoped',
          path: '/account', domain, secure: true }]) as { value: string; path: string; hostOnly: boolean };
        assert.equal(scoped.value, 'scoped'); assert.equal(scoped.path, '/account'); assert.equal(scoped.hostOnly, domain === undefined);
      }
      const rootCookie = await invoke(full, 'cookies.get', [{ url: 'https://only.allowed.test/', name: 'created' }]) as { value: string };
      assert.equal(rootCookie.value, 'real');
      await until(async () => (await invoke(full, 'events') as Array<{ kind: string; changeInfo?: { cookie: { name: string } } }>).some(event => event.kind === 'cookieChanged' && event.changeInfo?.cookie.name === 'created'), 'worker cookie event');
      assert.deepEqual(await invoke(full, 'storage.managed.get', [{ policy: 'default' }]), { policy: 'default' });
      await assert.rejects(invoke(full, 'storage.managed.set', [{ policy: 'write' }]), /read-only/);
      const callbackError = await full.executeJavaScript(`new Promise(resolve => chrome.cookies.get({url:'https://secret.test/',name:'secret'}, value => resolve({
        failed: value === undefined, message: chrome.runtime.lastError?.message
      })))`) as { failed: boolean; message: string };
      assert.equal(callbackError.failed, true); assert.match(callbackError.message, /Host permission/);
      assert.equal(await full.executeJavaScript('chrome.runtime.lastError'), undefined);
      const matches = await invoke(full, 'bookmarks.search', ['Shared bookmark']) as Array<{ id: string }>;
      assert.deepEqual(matches.map(item => item.id), ['existing']);
      await invoke(full, 'bookmarks.update', ['existing', { title: 'Edited in extension' }]);
      assert.equal(await owner.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)})).nodes.find(node => node.id === 'existing').title`), 'Edited in extension');
      assert.equal(await owner.webContents.executeJavaScript('window.bookmarkNotifications'), 1);
      await assert.rejects(invoke(full, 'bookmarks.remove', [BOOKMARK_BAR_ID]), /root/);
      await owner.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)}, '{broken')`);
      await assert.rejects(invoke(full, 'bookmarks.update', ['existing', { title: 'must not replace corrupt data' }]));
      assert.equal(await owner.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)})`), '{broken');
      await owner.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(tree))})`);
      if (phase === 'restore') {
        assert.equal(await invoke(full, 'permissions.remove', [{ permissions: ['sidePanel'] }]), true);
        await assert.rejects(full.executeJavaScript('chrome.sidePanel.getOptions({})'), /sidePanel permission required/);
        await assert.rejects(invoke(full, 'sidePanel.getOptions', [{}]), /sidePanel permission required/);
        assert.equal(await invoke(full, 'permissions.remove', [{ permissions: ['favicon'] }]), true);
        assert.equal(await full.executeJavaScript(`fetch(chrome.runtime.getURL('/_favicon/') + '?pageUrl=https%3A%2F%2Fonly.allowed.test&size=32').then(response=>response.status)`), 403);
        assert.equal(await invoke(full, 'permissions.remove', [{ origins: ['https://only.allowed.test/*'] }]), true);
        assert.deepEqual(await invoke(full, 'cookies.getAll', [{}]), []);
        await browser.cookies.set({ url: 'https://only.allowed.test/', name: 'after-revoke', value: 'hidden', secure: true });
        assert.equal(await service.remove(first), true);
        const state = JSON.parse(await readFile(path.join(browser.storagePath!, 'extensions-state.json'), 'utf8'));
        assert.equal(state.optionalPermissions[first], undefined);
      }
    }
    console.log(`EXTENSION_APIS_${phase.toUpperCase()}_OK`);
  } finally {
    service.dispose(); assert.equal(process.emitWarning, nativeEmitWarning);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  }
}

async function verifyOptionalMenus(full: WebContents, restricted: WebContents, service: BrowserExtensionService, owner: BrowserWindow) {
  const stop = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US',
    activeKeyboardShortcutBindings: () => new Set(), browserTabIdForWebContents: () => null,
    contextMenus: {} as BrowserContextMenuSession, isAllowedExtensionUrl: url => service.allowsPage(url),
    onGuestAttached: contents => service.track(contents) });
  try {
    const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
      view.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)}); view.src = 'https://private.test/'; document.body.appendChild(view); })()`);
    const guest = await attached;
    await until(() => !guest.isLoading() && guest.getURL() === 'https://private.test/', 'menu target');
    await verifyTabReads(full, restricted, service, owner, guest);
    const params = { pageURL: 'https://private.test/', frameURL: 'https://private.test/', selectionText: 'private selection',
      linkURL: '', srcURL: '', mediaType: 'none', isEditable: false } as Electron.ContextMenuParams;
    await full.executeJavaScript(`window.menuClicks = []; chrome.contextMenus.onClicked.addListener((info, tab) => window.menuClicks.push({info,tab}));
      new Promise(resolve => chrome.contextMenus.create({id:'optional-menu',title:'Ask',contexts:['selection']}, resolve))`);
    const [captured] = service.contextMenuItems(guest, params);
    assert(captured);
    captured.click!();
    await until(() => full.executeJavaScript('window.menuClicks.length === 1'), 'optional menu event');
    assert.equal(await full.executeJavaScript('window.menuClicks[0].info.selectionText'), params.selectionText);
    assert.equal(await invoke(full, 'permissions.remove', [{ permissions: ['contextMenus'] }]), true);
    assert.deepEqual(service.contextMenuItems(guest, params), []);
    captured.click!();
    assert.equal(await invoke(full, 'permissions.request', [{ permissions: ['contextMenus'] }]), true);
    assert.deepEqual(service.contextMenuItems(guest, params), []);
    captured.click!();
    await full.executeJavaScript(`new Promise(resolve => chrome.contextMenus.create({id:'optional-menu',title:'New',contexts:['selection']}, resolve))`);
    captured.click!();
    await restricted.executeJavaScript(`new Promise(resolve => chrome.contextMenus.create({id:'denied',title:'Denied'}, () => resolve(chrome.runtime.lastError?.message)))`)
      .then(message => assert.match(message, /contextMenus permission required/));
    assert.equal(await full.executeJavaScript('window.menuClicks.length'), 1);
    const [fresh] = service.contextMenuItems(guest, params);
    fresh.click!();
    await until(() => full.executeJavaScript('window.menuClicks.length === 2'), 'reauthorized menu event');
    await invoke(full, 'contextMenus.removeAll');
  } finally { stop(); }
}

async function verifyTabReads(full: WebContents, restricted: WebContents, service: BrowserExtensionService, owner: BrowserWindow, guest: WebContents) {
  const assertVisible = (tab: { url?: string; title?: string }) => {
    assert.equal(tab.url, guest.getURL()); assert.equal(tab.title, guest.getTitle());
  };
  const read = (contents: WebContents) => contents.executeJavaScript(`chrome.tabs.get(${guest.id})`);
  const query = { url: 'https://private.test/*', title: 'Private? tab', audible: false };
  assertVisible(await read(full));
  assert.equal((await read(restricted)).url, undefined);
  assertVisible(await invoke(full, 'tabs.get', [guest.id]) as { url?: string; title?: string });
  assert.equal((await invoke(restricted, 'tabs.get', [guest.id]) as { url?: string }).url, undefined);
  const queried = await full.executeJavaScript(`chrome.tabs.query(${JSON.stringify(query)})`) as Array<{ id: number }>;
  assert(queried.some(tab => tab.id === guest.id));
  assert.deepEqual(await restricted.executeJavaScript(`chrome.tabs.query(${JSON.stringify(query)})`), []);
  const callback = await full.executeJavaScript(`new Promise(resolve => chrome.tabs.get(${guest.id}, tab => resolve({tab,error:chrome.runtime.lastError?.message})))`);
  assertVisible(callback.tab); assert.equal(callback.error, undefined);
  await full.executeJavaScript('window.tabClicks = []; chrome.action.onClicked.addListener(tab => window.tabClicks.push(tab));');
  const click = async () => {
    assert.equal(await service.ui.activate(guest.session.extensions.getExtension(new URL(full.getURL()).hostname)!, owner, guest.id), true);
    return until(() => full.executeJavaScript('window.tabClicks.shift()'), 'action receives tab');
  };
  assertVisible(await click());
  assert.equal(await full.executeJavaScript("chrome.permissions.remove({permissions:['tabs']})"), true);
  assert.equal((await read(full)).url, undefined);
  assert.equal((await invoke(full, 'tabs.get', [guest.id]) as { url?: string }).url, undefined);
  assert.deepEqual(await full.executeJavaScript(`chrome.tabs.query(${JSON.stringify(query)})`), []);
  assert.equal((await click()).url, undefined);
  const own = await full.executeJavaScript("chrome.tabs.query({url:chrome.runtime.getURL('control.html')})") as Array<{ id: number }>;
  assert(own.some(tab => tab.id === full.id), 'own extension documents remain readable without tabs permission');
  // A narrower host grant still authorizes its page after the global tabs grant is removed.
  await guest.loadURL('https://only.allowed.test/');
  assertVisible(await read(full));
  assertVisible(await read(restricted));
  assert.equal(await full.executeJavaScript("chrome.permissions.request({permissions:['tabs']})", true), true);
  await guest.loadURL('https://private.test/');
}

async function checkOriginals(browser: Session, owner: BrowserWindow, service: BrowserExtensionService) {
  let itabTabId: number | null = null;
  for (const extension of browser.extensions.getAllExtensions()) {
    const worker = await startExtensionWorker(browser, extension.id);
    assert.equal(worker.isDestroyed(), false);
    const contents = await control(browser, owner, extension);
    assert.equal(await contents.executeJavaScript('typeof window.setsunaDesktop'), 'undefined');
    if (extension.id === 'hlkenndednhfkekhgcdicdfddnkalmdm') {
      assert.equal(await contents.executeJavaScript(`chrome.permissions.request({origins:['https://only.allowed.test/*']})`, true), true);
      await browser.cookies.set({ url: 'https://only.allowed.test/', name: 'original', value: 'round-trip', secure: true });
      const result = await contents.executeJavaScript(`chrome.runtime.sendMessage({type:'getAllCookies',params:{url:'https://only.allowed.test/'}})`) as Array<{ value: string }>;
      assert.equal(result.some(cookie => cookie.value === 'round-trip'), true);
    } else if (extension.id === 'mhloojimgilafopcmlcikiidgbbnelip') {
      const result = await contents.executeJavaScript(`chrome.runtime.sendMessage({type:'searchBookmarks',keyword:'Shared bookmark'})`) as Array<{ id: string }>;
      assert.deepEqual(result.map(item => item.id), ['existing']);
      const permissions = await contents.executeJavaScript(`chrome.runtime.sendMessage({type:'getAllPermissions'})`) as { permissions: string[] };
      assert.equal(permissions.permissions.includes('bookmarks'), true);
      itabTabId = await checkItabAuthorization(owner, extension, service);
    } else if (extension.id === 'dhdgffkkebhmkfjojejmpbldmpobfkfo') {
      assert.deepEqual(await contents.executeJavaScript('chrome.storage.managed.get(null)'), {});
    } else if (extension.id === 'neaebjphlfplgdhedjdhcnpjkndddbpd') {
      if (phase === 'originals-restore') {
        const cached = await contents.executeJavaScript(`chrome.storage.local.get('tabs')`) as { tabs?: Record<string, unknown> };
        assert.deepEqual(cached.tabs ?? {}, {});
      }
      await checkVueTelescope(owner, contents, service);
      if (phase === 'originals' && itabTabId !== null) {
        // Mimic the previous process's cached webpage occupying the new process's iTab ID.
        await contents.executeJavaScript(`chrome.storage.local.set({tabs:{${itabTabId}:{hasVue:false,url:'https://old-page.test/'}}})`);
        await writeFile(path.join(directory, 'itab-tab-id'), String(itabTabId));
      }
    }
    console.log(`ORIGINAL_EXTENSION_WORKER_OK ${extension.id}`);
  }
}

async function checkItabAuthorization(owner: BrowserWindow, extension: Extension, service: BrowserExtensionService): Promise<number> {
  const stop = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US',
    activeKeyboardShortcutBindings: () => new Set(), browserTabIdForWebContents: () => null,
    contextMenus: {} as BrowserContextMenuSession, isAllowedExtensionUrl: url => service.allowsPage(url),
    onGuestAttached: contents => service.track(contents) });
  try {
    const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    const url = extensionPageUrl(extension, 'newtab')!;
    await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
      view.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)}); view.src = ${JSON.stringify(url)}; document.body.appendChild(view); })()`);
    const contents = await attached;
    await until(() => !contents.isLoading() && contents.getURL() === url, 'iTab new tab');
    if (phase === 'originals-restore') {
      const previous = await readFile(path.join(directory, 'itab-tab-id'), 'utf8').catch(() => null);
      if (previous !== null) assert.equal(contents.id, Number(previous));
    }
    // Execute the unmodified authorization button's handler with its exact permission request.
    const chunks = await Promise.all((await readdir(path.join(extension.path, 'chunks')))
      .filter(name => /^overlay-[\w-]+\.js$/.test(name))
      .map(async name => ({ name, source: await readFile(path.join(extension.path, 'chunks', name), 'utf8') })));
    const chunk = chunks.find(module => /export\{[^}]*\bas enableOverlay\b/.test(module.source))?.name;
    assert(chunk, 'iTab overlay authorization module');
    await contents.executeJavaScript(`import(${JSON.stringify(`./chunks/${chunk}`)}).then(module => module.enableOverlay(true))`, true);
    assert.equal(await contents.executeJavaScript(`chrome.permissions.contains({permissions:['tabs','favicon'],origins:['<all_urls>']})`), true);
    return contents.id;
  } finally { stop(); }
}

async function checkVueTelescope(owner: BrowserWindow, control: WebContents, service: BrowserExtensionService) {
  // Extension webRequest handlers can bypass Electron's custom HTTP protocol in guests.
  // A loopback server keeps this native message probe local in either request path.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Static webpage</title><body>Fixture</body>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject).listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address(); assert(address && typeof address !== 'string');
  const stop = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US',
    activeKeyboardShortcutBindings: () => new Set(), browserTabIdForWebContents: () => null,
    contextMenus: {} as BrowserContextMenuSession, isAllowedExtensionUrl: url => service.allowsPage(url),
    onGuestAttached: contents => service.track(contents) });
  const create = async (url: string) => {
    const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
      view.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)}); view.src = ${JSON.stringify(url)};
      document.body.appendChild(view); })()`);
    const contents = await attached;
    await until(() => !contents.isLoading() && contents.getURL() === url, 'Vue Telescope target loads');
    return contents;
  };
  try {
    const webpage = await create(`http://127.0.0.1:${address.port}/index.html`);
    // The unmodified content script and worker must exchange real detection data.
    await until(() => control.executeJavaScript(`chrome.storage.local.get('tabs').then(value => value.tabs?.[${webpage.id}])`), 'Vue Telescope content script sends analysis');
    const message = { from: 'background', to: 'injected', action: 'analyze', payload: {} };
    await control.executeJavaScript(`chrome.tabs.sendMessage(${webpage.id}, ${JSON.stringify(message)})`);
    const blank = await create('about:blank');
    await assert.rejects(control.executeJavaScript(`chrome.tabs.sendMessage(${blank.id}, ${JSON.stringify(message)})`),
      /Receiving end does not exist/);
    console.log('VUE_TELESCOPE_NATIVE_MESSAGING_OK');
  } finally {
    stop();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}

function extensionId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
}

async function writeExtension(root: string, permissions: string[], hosts: string[], optionalHosts: string[]): Promise<string> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' }); const id = extensionId(key);
  const installation = path.join(root, 'Extensions', id, '1.0.0_0'); await mkdir(installation, { recursive: true });
  const manifest = { manifest_version: 3, name: 'API fixture', version: '1.0.0', key: key.toString('base64'),
    permissions, host_permissions: hosts, optional_permissions: ['tabs', 'favicon', 'sidePanel', 'contextMenus'], optional_host_permissions: optionalHosts,
    content_scripts: [{ matches: ['https://only.allowed.test/*'], js: ['content.js'] }],
    action: { default_popup: 'control.html' }, background: { service_worker: 'worker.js' } };
  await writeFile(path.join(installation, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(installation, 'control.html'), '<!doctype html><title>Extension control</title>');
  await writeFile(path.join(installation, 'content.js'), 'void 0;');
  await writeFile(path.join(installation, 'worker.js'), `const events = [];
    chrome.runtime.onStartup.addListener(() => chrome.storage?.local.get({startupCount:0}).then(value =>
      chrome.storage.local.set({startupCount:value.startupCount+1})));
    chrome.cookies?.onChanged.addListener(changeInfo => events.push({kind:'cookieChanged',changeInfo}));
    chrome.permissions.onAdded.addListener(permissions => events.push({kind:'permissionsAdded',permissions}));
    chrome.permissions.onRemoved.addListener(permissions => events.push({kind:'permissionsRemoved',permissions}));
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message.method === 'events') { reply({ok:true,result:events}); return; }
      if (message.method === 'favicon') {
        fetch(chrome.runtime.getURL('/_favicon/')+'?pageUrl=https%3A%2F%2Fonly.allowed.test&size=32',{signal:AbortSignal.timeout(3000)})
          .then(response=>reply({ok:true,result:response.headers.get('content-type')}),error=>reply({ok:false,error:error.message}));
        return true;
      }
      const parts = message.method.split('.'); const method = parts.pop();
      const api = parts.reduce((scope, key) => scope[key], chrome);
      Promise.resolve().then(() => api[method](...message.args)).then(result => reply({ok:true,result}), error => reply({ok:false,error:error.message}));
      return true;
    });`);
  return id;
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
