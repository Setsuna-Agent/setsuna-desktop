import assert from 'node:assert/strict';
import { cp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

const directory = process.argv[2];
const source = process.argv[3];
const id = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
app.setPath('userData', path.join(directory, 'profile')); app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
BrowserWindow.prototype.showInactive = () => undefined;
const code = `// ==UserScript==
// @name Setsuna native integration
// @namespace https://setsuna.test
// @version 1.0
// @match http://127.0.0.1/*
// @grant GM_getValue
// @grant GM_setValue
// ==/UserScript==
const count = GM_getValue('count', 0) + 1;
GM_setValue('count', count);
document.documentElement.dataset.tmCount = String(count);`;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const installation = path.join(browserSession.storagePath!, 'Extensions', id, path.basename(source));
  await mkdir(path.dirname(installation), { recursive: true });
  // Use the downloaded, unmodified store installation; third-party extension code stays out of Git.
  await cp(source, installation, { recursive: true });
  const server = createServer((request, response) => {
    if (request.url?.endsWith('.user.js')) {
      response.setHeader('Content-Type', 'text/javascript'); response.end(code); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Test</title><a id="install" href="/example.user.js">Install userscript</a>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const service = new BrowserExtensionService({
    preloadPath: path.join(directory, 'extensions.cjs'), session: browserSession,
    owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    activeOwner: () => owner,
    language: () => 'en-US', publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined,
  });
  const modeSelect = "Array.from(document.querySelectorAll('select')).find(element => element.key === 'configMode')";
  const openOptions = async () => {
    assert.equal(await service.open(id, 'options', owner), true);
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL() === `chrome-extension://${id}/options.html`);
    assert.ok(window);
    await until(() => window.webContents.executeJavaScript(`!!(${modeSelect})`), 'Tampermonkey settings initialization');
    return window;
  };
  const stop = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: () => 'test-tab', contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: (url) => service.allowsPage(url), onGuestAttached: (contents) => service.track(contents),
  });
  try {
    await service.start();
    assert.equal(service.list()[0]?.id, id);
    assert.equal(service.list()[0].allowUserScripts, false);
    // A real settings interaction exercises document initialization and worker communication
    // while userScripts is unavailable, rather than only calling the background's API.
    let control = await openOptions();
    assert.equal(await control.webContents.executeJavaScript('typeof chrome.userScripts'), 'undefined');
    await control.webContents.executeJavaScript(`(() => {
      const mode = ${modeSelect}; mode.value = '50'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    // Tampermonkey batches native storage writes; its in-memory option value is optimistic.
    await until(() => control.webContents.executeJavaScript(`chrome.storage.local.get('!extdb.#config')
      .then(data => String(data['!extdb.#config']?.value?.configMode) === '50')`), 'Tampermonkey saves its setting');
    await service.setUserScriptsAllowed(id, true);
    control = await openOptions();
    assert.equal(await control.webContents.executeJavaScript(`(${modeSelect}).value`), '50');
    await until(() => control.webContents.executeJavaScript('chrome.userScripts.getScripts().then(scripts => scripts.length >= 2)'), 'Tampermonkey runtime registrations');
    const attached = new Promise<Electron.WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    const scriptIds = () => control.webContents.executeJavaScript(`chrome.storage.local.get().then(data =>
      Object.keys(data).filter(key => key.startsWith('!extdb.@meta#')).map(key => key.slice('!extdb.@meta#'.length)))`) as Promise<string[]>;
    const openInstaller = async (scriptPath: string) => {
      await guest.loadURL(`http://127.0.0.1:${port}/`);
      await guest.executeJavaScript(`(() => { const link = document.getElementById('install'); link.href = ${JSON.stringify(scriptPath)}; link.click(); })()`);
      const installer = await until(() => BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().startsWith(`chrome-extension://${id}/ask.html?aid=`)), 'Tampermonkey opens its installation confirmation');
      await until(() => installer.webContents.executeJavaScript(`document.body.innerText.includes('Setsuna native integration') &&
        !!Array.from(document.querySelectorAll('input,button')).find(element => element.value === 'Install' || element.textContent === 'Install')`),
      'Tampermonkey displays the downloaded script');
      // Metadata and the install button appear before the source preview finishes loading.
      await until(() => installer.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.CodeMirror'))
        .some(element => element.CodeMirror?.getValue().includes('document.documentElement.dataset.tmCount')) ||
        Array.from(document.querySelectorAll('textarea')).some(element => element.value.includes('document.documentElement.dataset.tmCount'))`),
      'Tampermonkey loads the script source');
      assert.match(guest.getURL(), /^https:\/\/www\.tampermonkey\.net\/script_installation\.php#url=/);
      assert.deepEqual(await scriptIds(), []);
      return installer;
    };
    const click = (window: BrowserWindow, label: string) => window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('input,button'))
      .find(element => element.value === ${JSON.stringify(label)} || element.textContent === ${JSON.stringify(label)}).click()`);
    let installer = await openInstaller('/example.user.js');
    await click(installer, 'Cancel');
    await until(() => installer.isDestroyed(), 'cancel closes the installation confirmation');
    await until(() => guest.getURL() === `http://127.0.0.1:${port}/` && !guest.isLoading(), 'cancel returns from the intermediary');
    assert.deepEqual(await scriptIds(), []);
    // The original extension de-bounces identical install links for one second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    installer = await openInstaller('/example.user.js');
    await click(installer, 'Install');
    await until(() => installer.isDestroyed(), 'install closes the installation confirmation');
    const [uuid] = await until(async () => { const ids = await scriptIds(); return ids.length === 1 ? ids : null; }, 'script saved after confirmation');
    const storedCount = () => control.webContents.executeJavaScript(`chrome.storage.local.get().then(data => data['!extdb.@st#${uuid}']?.value?.data?.count)`);
    await until(() => guest.executeJavaScript('document.documentElement.dataset.tmCount === "1"'), 'Tampermonkey execution');
    await until(async () => await storedCount() === 'n1', 'GM_setValue persistence');
    guest.reload();
    await until(() => guest.executeJavaScript('document.documentElement.dataset.tmCount === "2"'), 'GM_getValue after reload');
    await until(async () => await storedCount() === 'n2', 'second GM_setValue persistence');
    await service.setUserScriptsAllowed(id, false);
    await guest.loadURL(`http://127.0.0.1:${port}/disabled`);
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.tmCount'), undefined);
    control = await openOptions();
    assert.equal(await control.webContents.executeJavaScript('typeof chrome.userScripts'), 'undefined');
    assert.equal(await control.webContents.executeJavaScript(`(${modeSelect}).value`), '50');
    console.log(`TAMPERMONKEY_${service.list()[0].version}_OK`);
  } finally { service.dispose(); stop(); owner.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
