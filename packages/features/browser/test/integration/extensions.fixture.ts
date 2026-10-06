import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, nativeImage, session } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import { clearBrowserSessionData } from '../../src/main/settings/data.js';
import type { BrowserPasswordStore } from '../../src/main/passwords/store.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

const directory = process.argv[2];
const phase = process.argv[3];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
let approved = false;
let confirmations = 0;
dialog.showMessageBox = (async () => {
  confirmations++;
  return { response: approved ? 1 : 0, checkboxChecked: false };
}) as typeof dialog.showMessageBox;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const stopWebviews = installEmbeddedBrowserWebviews({
    mainWindow: owner, interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: () => 'test-tab', contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: (url) => service.allowsPage(url),
    onGuestAttached: (contents) => service.actions.track(contents),
  });
  const service = new BrowserExtensionService({
    preloadPath: path.join(directory, 'actions.cjs'), actionsChanged: () => undefined,
    session: browserSession, owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    language: () => 'en-US', publish: () => undefined, openWebPage: () => undefined,
  });
  const manifest = {
    manifest_version: 3, name: '__MSG_appName__', default_locale: 'en', version: '1.0.0', permissions: ['storage'],
    content_scripts: [{ matches: ['https://example.test/*'], js: ['content.js'] }],
    action: { default_popup: 'popup.html' }, options_ui: { page: 'options.html' },
    background: { service_worker: 'worker.js' },
    chrome_url_overrides: { newtab: 'newtab.html' },
  };
  const fixture = createCrx(manifest);
  let downloads = 0;
  browserSession.protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'clients2.google.com') {
      downloads++;
      return new Response(new Uint8Array(fixture.bytes), { headers: { 'Content-Type': 'application/x-chrome-extension' } });
    }
    if (url.pathname === '/icon.png') return new Response(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=', 'base64')));
    return new Response('<!doctype html><title>Extension test</title><p>Test document</p>', { headers: { 'Content-Type': 'text/html' } });
  });
  try {
    await service.start();
    const attached = new Promise<Electron.WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    if (phase === 'install') {
      await guest.loadURL('https://chromewebstore.google.com.evil.test/');
      assert.equal(await guest.executeJavaScript('typeof window.electronWebstore'), 'undefined');
      await guest.loadURL('https://chromewebstore.google.com/');
      await until(() => guest.executeJavaScript('typeof chrome.webstorePrivate?.beginInstallWithManifest3 === "function"'), 'store preload');
      const details = { id: fixture.id, localizedName: manifest.name, manifest: JSON.stringify(manifest), iconUrl: 'https://chromewebstore.google.com/icon.png' };
      const install = () => guest.executeJavaScript(`chrome.webstorePrivate.beginInstallWithManifest3(${JSON.stringify(details)})`);
      assert.equal(await install(), 'user_cancelled');
      assert.equal(downloads, 0);
      assert.equal(service.list().length, 0);
      approved = true;
      // A stale store manifest must not silently grant the downloaded script's site access.
      const incomplete = { ...details, manifest: JSON.stringify({ ...manifest, content_scripts: [] }) };
      assert.equal(await guest.executeJavaScript(`chrome.webstorePrivate.beginInstallWithManifest3(${JSON.stringify(incomplete)})`), 'install_error');
      assert.equal(service.list().length, 0);
      assert.equal((await readdir(path.join(browserSession.storagePath!, 'Extensions', fixture.id))).length, 0);
      assert.equal(await install(), 'success');
      await until(() => service.list().length === 1, 'installed extension metadata');
      assert.equal(confirmations, 3);
      assert.equal(downloads, 2);
      assert.equal(service.list()[0].id, fixture.id);
      assert.equal(service.list()[0].hasPopup, true);
      assert.equal(service.list()[0].hasOptions, true);
      assert.equal(service.list()[0].enabled, true);
      await writeFile(path.join(directory, 'extension-id'), fixture.id);
    } else {
      const id = await readFile(path.join(directory, 'extension-id'), 'utf8');
      assert.equal(service.list()[0]?.id, id);
      assert.equal(downloads, 0);
      if (phase === 'disabled') {
        assert.equal(service.list()[0].enabled, false);
        assert.equal(service.list()[0].name, 'Setsuna extension test');
        assert.equal(browserSession.extensions.getExtension(id), null);
        assert.equal(await service.open(id, 'popup', owner), false);
        await guest.loadURL('https://example.test/disabled');
        assert.equal(await guest.executeJavaScript('document.documentElement.dataset.extensionReady'), undefined);
        assert.deepEqual(await Promise.all([
          service.setEnabled(id, true), service.setEnabled(id, false), service.setEnabled(id, true),
        ]), [true, true, true]);
      }
      assert.equal(service.list()[0].enabled, true);
    }
    assert.equal(service.list()[0].name, 'Setsuna extension test');
    await guest.loadURL('https://example.test/');
    await until(() => guest.executeJavaScript('document.documentElement.dataset.extensionReady === "yes"'), 'native content script and storage');
    assert.equal(await guest.executeJavaScript('typeof window.electronWebstore'), 'undefined');
    const id = service.list()[0].id;
    await until(() => service.actions.snapshot().find((item) => item.id === id)?.title === 'Extension default', 'default action from worker startup');
    const newTabUrl = `chrome-extension://${id}/newtab.html`;
    assert.equal(service.list()[0].newTabUrl, newTabUrl);
    assert.equal(service.allowsPage(newTabUrl), true);
    assert.equal(service.allowsPage(`chrome-extension://${'b'.repeat(32)}/newtab.html`), false);
    const newTabAttached = new Promise<Electron.WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript(`(() => {
      const tab = document.createElement('webview');
      tab.setAttribute('partition', ${JSON.stringify(DESKTOP_BROWSER_PARTITION)});
      tab.setAttribute('src', ${JSON.stringify(newTabUrl)});
      document.body.append(tab);
    })()`);
    const newTab = await newTabAttached;
    await until(() => newTab.executeJavaScript('document.documentElement.dataset.extensionReady === "yes"'), 'native extension new tab');
    assert.equal(await newTab.executeJavaScript('chrome.runtime.id'), id);
    assert.equal(await newTab.executeJavaScript('typeof window.setsunaDesktop'), 'undefined');
    if (phase === 'disabled') assert.equal(await newTab.executeJavaScript('localStorage.getItem("settings-test")'), 'extension');
    await guest.loadURL('https://example.test/detected');
    await until(() => {
      const state = service.actions.snapshot(guest.id).find((item) => item.id === id);
      return state?.popup?.endsWith('/active.html') && state.icon && state.title === 'Detected';
    }, 'native action updates from the worker');
    const action = service.actions.snapshot(guest.id).find((item) => item.id === id)!;
    assert.equal(action.title, 'Detected');
    assert.equal(action.icon?.startsWith('data:image/png;base64,'), true);
    assert.equal(service.actions.snapshot(newTab.id).find((item) => item.id === id)?.popup, undefined);
    assert.equal(await service.open(id, 'popup', owner, undefined, guest.id), true);
    const activePopup = BrowserWindow.getAllWindows().find((window) => window !== owner)!;
    assert.equal(await activePopup.webContents.executeJavaScript('document.title'), 'Active popup');
    activePopup.destroy();
    await guest.loadURL('https://example.test/');
    assert.equal(service.actions.snapshot(guest.id).find((item) => item.id === id)?.popup, undefined);
    const openPopup = async () => {
      assert.equal(await service.open(id, 'popup', owner, { x: 500, y: 40, width: 28, height: 28 }), true);
      return BrowserWindow.getAllWindows().find((window) => window !== owner)!;
    };
    const dismissed = await openPopup();
    dismissed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(() => dismissed.isDestroyed(), 'Escape dismisses extension popup');
    const blurred = await openPopup();
    blurred.emit('blur');
    assert.equal(blurred.isDestroyed(), true);
    const moved = await openPopup();
    owner.emit('move');
    assert.equal(moved.isDestroyed(), true);
    const toggled = await openPopup();
    assert.equal(await service.open(id, 'popup', owner), true);
    assert.equal(toggled.isDestroyed(), true);
    const popup = await openPopup();
    await until(() => popup.webContents.executeJavaScript('document.title === "Extension popup"'), 'extension popup');
    assert.equal(await popup.webContents.executeJavaScript('typeof window.setsunaDesktop'), 'undefined');
    assert.equal(await service.remove('../outside'), false);
    await guest.executeJavaScript('localStorage.setItem("settings-test", "website")');
    await newTab.executeJavaScript('localStorage.setItem("settings-test", "extension")');
    await browserSession.cookies.set({ url: 'https://example.test', name: 'settings-test', value: 'website' });
    await session.defaultSession.cookies.set({ url: 'https://example.test', name: 'settings-test', value: 'desktop' });
    await clearBrowserSessionData(browserSession, {} as BrowserPasswordStore, { cookies: true, siteStorage: true });
    assert.equal(await guest.executeJavaScript('localStorage.getItem("settings-test")'), null);
    assert.equal(await newTab.executeJavaScript('localStorage.getItem("settings-test")'), 'extension');
    assert.equal((await browserSession.cookies.get({ name: 'settings-test' })).length, 0);
    assert.equal((await session.defaultSession.cookies.get({ name: 'settings-test' }))[0].value, 'desktop');
    if (phase === 'install') {
      assert.equal(await service.setEnabled('../outside', false), false);
      assert.equal(await service.setEnabled(id, false), true);
      assert.equal(service.list().length, 1);
      assert.equal(service.list()[0].enabled, false);
      assert.equal(service.list()[0].name, 'Setsuna extension test');
      assert.equal(service.list()[0].newTabUrl, null);
      assert.equal(service.allowsPage(newTabUrl), false);
      assert.equal(service.actions.snapshot().some((item) => item.id === id), false);
      assert.equal(popup.isDestroyed(), true);
      assert.equal(await service.open(id, 'options', owner), false);
      await guest.loadURL('https://example.test/disabled');
      assert.equal(await guest.executeJavaScript('document.documentElement.dataset.extensionReady'), undefined);
      // Disabled extensions must retain their own data when website storage is cleared.
      await clearBrowserSessionData(browserSession, {} as BrowserPasswordStore, { siteStorage: true });
    }
    if (phase === 'restore') {
      assert.equal(await service.setEnabled(id, false), true);
      assert.equal(await service.remove(id), true);
      assert.equal(service.list().length, 0);
      assert.equal(service.allowsPage(newTabUrl), false);
      assert.equal(popup.isDestroyed(), true);
      assert.equal((await readdir(path.join(browserSession.storagePath!, 'Extensions'))).includes(id), false);
    }
    console.log(`EXTENSIONS_${phase.toUpperCase()}_OK`);
  } finally {
    service.dispose();
    stopWebviews();
    owner.destroy();
  }
}

function createCrx(manifest: unknown) {
  const require = createRequire(import.meta.url);
  const Zip = createRequire(require.resolve('electron-chrome-web-store'))('adm-zip');
  const zip = new Zip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  zip.addFile('_locales/en/messages.json', Buffer.from(JSON.stringify({ appName: { message: 'Setsuna extension test' } })));
  zip.addFile('worker.js', Buffer.from(`chrome.action.setTitle({ title: 'Extension default' });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message !== 'detected') return;
    Promise.all([
      chrome.action.setIcon({ tabId: sender.tab.id, path: chrome.runtime.getURL('icon.png') }),
      chrome.action.setPopup({ tabId: sender.tab.id, popup: 'active.html' }),
      new Promise(resolve => chrome.action.setTitle({ tabId: sender.tab.id, title: 'Detected' }, resolve)),
    ]).then(() => reply(true));
    return true;
  });`));
  zip.addFile('content.js', Buffer.from(`chrome.storage.local.set({ ready: true }).then(() => {
    document.documentElement.dataset.extensionReady = 'yes';
    if (location.pathname === '/detected') chrome.runtime.sendMessage('detected');
  });`));
  zip.addFile('icon.png', nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 }).toPNG());
  zip.addFile('active.html', Buffer.from('<title>Active popup</title>'));
  zip.addFile('popup.html', Buffer.from('<title>Extension popup</title><p>Popup</p>'));
  zip.addFile('options.html', Buffer.from('<title>Extension options</title>'));
  zip.addFile('newtab.html', Buffer.from('<title>Extension new tab</title><script src="content.js"></script>'));
  const contents = zip.toBuffer();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const hash = createHash('sha256').update(key).digest().subarray(0, 16);
  const id = hash.toString('hex').replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)));
  const varint = (value: number): Buffer => {
    const bytes = [];
    while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
    return Buffer.from([...bytes, value]);
  };
  const field = (tag: number, bytes: Buffer) => Buffer.concat([varint(tag * 8 + 2), varint(bytes.length), bytes]);
  const signed = field(1, hash);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signed.length);
  const signature = sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, contents]), privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, key), field(2, signature)])), field(10000, signed)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
  return { id, bytes: Buffer.concat([prefix, header, contents]) };
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
