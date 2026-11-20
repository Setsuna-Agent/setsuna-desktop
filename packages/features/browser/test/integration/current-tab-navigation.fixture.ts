import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { app, BrowserWindow, nativeImage, session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION, DESKTOP_BROWSER_PREVIEW_PARTITION } from '../../src/contracts/index.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import { DesktopBrowserController } from '../../src/main/control.js';
import { registerBrowserIpc } from '../../src/main/ipc.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function until(read: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const requests: Array<{ path: string; method: string; body: string; contentType: string | null }> = [];
  await browserSession.protocol.handle('https', async request => {
    requests.push({ path: new URL(request.url).pathname, method: request.method,
      body: await request.text(), contentType: request.headers.get('content-type') });
    const startup = new URL(request.url).pathname === '/startup' ? '<script>window.open("/startup-target", "report")</script>' : '';
    return new Response('<!doctype html>' + startup + '<title>Website</title><p>Loaded</p>', { headers: { 'Content-Type': 'text/html' } });
  });
  const owner = new BrowserWindow({ show: false, webPreferences: {
    webviewTag: true, contextIsolation: true, sandbox: true, backgroundThrottling: false,
    preload: path.join(process.argv[2], 'navigation.cjs'),
  } });
  const controller = new DesktopBrowserController();
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'current-tab-fixture', process: 'main' });
  scope.scope.add(registerBrowserIpc(scope.scope, controller,
    new Map([[owner.webContents.id, { window: owner, contextMenus: {} as BrowserContextMenuSession }]]), () => 'en-US'));
  scope.scope.add(() => controller.clear()); scope.activate();
  let newTabRequests = 0;
  const stop = installEmbeddedBrowserWebviews({
    mainWindow: owner, interfaceLanguage: () => 'en-US', activeKeyboardShortcutBindings: () => new Set(),
    browserTabIdForWebContents: id => controller.tabIdForWebContents(id),
    windowOpenMode: id => controller.windowOpenModeForWebContents(id),
    onNewTabRequested: () => { newTabRequests++; return undefined; },
    contextMenus: {} as BrowserContextMenuSession,
  });
  try {
    const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL('data:text/html,<!doctype html><body></body>');
    await owner.webContents.executeJavaScript(await readFile(path.join(process.argv[2], 'host.js'), 'utf8'));
    const guest = await attached;
    const origin = 'https://web-app.test';
    const loaded = (pathname: string) => until(() => guest.getURL() === origin + pathname && !guest.isLoading(), pathname);
    await loaded('/startup-target');
    assert.equal(newTabRequests, 0, 'parser-time window.open must not request a workspace tab');
    assert.equal(await owner.webContents.executeJavaScript('document.querySelectorAll("webview").length'), 1);
    assert.equal(controller.windowOpenModeForWebContents(guest.id), 'current-tab');
    await guest.loadURL(origin + '/');
    await guest.executeJavaScript(`localStorage.setItem('shared', 'browser-data');
      const link = document.createElement('a'); link.href = '/link'; link.target = '_blank';
      document.body.append(link); link.click(); null`, true);
    await loaded('/link');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal(guest.navigationHistory.canGoBack(), true);
    guest.navigationHistory.goBack();
    await loaded('/');

    await guest.executeJavaScript(`window.open('/script', 'report'); null`, true);
    await loaded('/script');
    for (const enctype of ['application/x-www-form-urlencoded', 'multipart/form-data']) {
      const pathname = enctype === 'multipart/form-data' ? '/multipart' : '/form';
      await guest.executeJavaScript(`const form = document.createElement('form');
        form.action = ${JSON.stringify(pathname)}; form.method = 'POST'; form.target = '_blank';
        form.enctype = ${JSON.stringify(enctype)}; form.innerHTML = '<input name="value" value="saved">';
        document.body.append(form); form.submit(); null`, true);
      await loaded(pathname);
      const request = requests.find(item => item.path === pathname)!;
      assert.equal(request.method, 'POST');
      assert.ok(request.contentType?.startsWith(enctype));
      if (enctype === 'multipart/form-data') {
        const boundary = request.contentType!.split('boundary=')[1];
        assert.ok(boundary && request.body.includes('--' + boundary));
        assert.ok(request.body.includes('name="value"\r\n\r\nsaved'));
      } else assert.equal(request.body, 'value=saved');
    }
    assert.equal(await guest.executeJavaScript(`localStorage.getItem('shared')`), 'browser-data');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal(await guest.executeJavaScript(`window.open('file:///private/blocked') === null`, true), true);
    assert.equal(guest.getURL(), origin + '/multipart');

    const previewSession = session.fromPartition(DESKTOP_BROWSER_PREVIEW_PARTITION);
    await previewSession.protocol.handle('https', () => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<button onclick="this.textContent = \'Clicked\'">Preview</button>', { headers: { 'Content-Type': 'text/html' } }));
    const previewReady = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    const previewUrl = origin + '/preview';
    const configure = owner.webContents.executeJavaScript(`(async () => {
      const bridge = window.navigationFixture;
      if (await bridge.configureWebPreview(${guest.id}, { url: ${JSON.stringify(previewUrl)}, interactive: true })) {
        throw new Error('The preview bridge accepted a normal browser tab');
      }
      const view = document.createElement('webview');
      view.id = 'design-preview';
      view.partition = ${JSON.stringify(DESKTOP_BROWSER_PREVIEW_PARTITION)};
      view.src = 'about:blank';
      view.style.cssText = 'position:absolute;left:0;top:0;width:314px;height:682px;opacity:0';
      const ready = new Promise(resolve => view.addEventListener('dom-ready', resolve, { once: true }));
      document.body.append(view);
      await ready;
      return bridge.configureWebPreview(view.getWebContentsId(), {
        url: ${JSON.stringify(previewUrl)}, interactive: false,
        device: { id: 'iphone-15-pro', width: 314, height: 682 },
      });
    })()`);
    const preview = await previewReady;
    assert.equal(preview.session, previewSession);
    assert.equal(await configure, true);
    assert.equal(preview.getURL(), previewUrl);
    assert.deepEqual(await preview.executeJavaScript(`{
      const button = document.querySelector('button');
      button.click();
      [button.textContent, localStorage.getItem('shared'), typeof process, innerWidth, navigator.maxTouchPoints];
    }`, true), ['Clicked', null, 'undefined', 314, 5]);
    assert.equal(await preview.executeJavaScript(`window.open('/preview-popup') === null`, true), true);
    const previewImage: string = await owner.webContents.executeJavaScript(`window.navigationFixture.captureWebPreview(${preview.id})`);
    assert.equal(nativeImage.createFromDataURL(previewImage).isEmpty(), false, 'inactive web content is usable as a canvas preview');
    assert.equal(await owner.webContents.executeJavaScript(`(async () => {
      const view = document.querySelector('#design-preview');
      const bridge = window.navigationFixture;
      window.previewEscape = new Promise(resolve => {
        const stop = bridge.onWebPreviewEscape(id => { stop(); resolve(id); });
      });
      view.style.opacity = '1';
      view.focus();
      return bridge.configureWebPreview(view.getWebContentsId(), {
        url: ${JSON.stringify(previewUrl)}, interactive: true,
        device: { id: 'iphone-15-pro', width: 314, height: 682 },
      });
    })()`), true);
    preview.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    assert.equal(await owner.webContents.executeJavaScript('window.previewEscape'), preview.id);
    assert.equal(newTabRequests, 0);
    console.log('CURRENT_TAB_NAVIGATION_OK');
  } finally { stop(); await scope.finishDispose(); owner.destroy(); }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
