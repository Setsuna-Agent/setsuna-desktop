import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, protocol, session, type WebFrameMain } from 'electron';
import { PluginUiDocuments, pluginUiDocumentScheme } from '../../src/window/plugin-ui-documents.js';

app.setPath('userData', process.argv[2]);
app.disableHardwareAcceleration();
// Exercise permission denial even on CI machines without physical capture devices.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.dock?.hide();
protocol.registerSchemesAsPrivileged([pluginUiDocumentScheme]);

async function until(read: () => WebFrameMain | undefined): Promise<WebFrameMain> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const frame = read(); if (frame) return frame;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Plugin frame did not load');
}

async function main() {
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const documents = new PluginUiDocuments();
  const focusUpdates: Promise<unknown>[] = [];
  let response = 0; let prompts = 0;
  dialog.showMessageBox = async () => { prompts++; return { response, checkboxChecked: false }; };
  const addFrame = async (url: string, name: string) => {
    await owner.webContents.executeJavaScript(`(() => { const frame = document.createElement('iframe');
      frame.name = ${JSON.stringify(name)}; frame.allow = 'camera *; microphone *; geolocation *; clipboard-read *; clipboard-write *';
      frame.src = ${JSON.stringify(url)}; document.body.append(frame); })()`);
    return until(() => owner.webContents.mainFrame.frames.find(frame => frame.name === name && frame.url === url));
  };
  const query = (frame: WebFrameMain) => frame.executeJavaScript(`Promise.all(['camera','microphone','geolocation','clipboard-read']
    .map(name => navigator.permissions.query({name}).then(result => result.state)))`);
  const readClipboard = async (frame: WebFrameMain) => {
    await Promise.all(focusUpdates);
    return frame.executeJavaScript(`navigator.clipboard.readText().then(() => 'read', error => error.name)`, true);
  };
  try {
    const host = path.join(process.argv[2], 'host.html');
    await writeFile(host, '<!doctype html><body></body>');
    await owner.loadFile(host);
    // Clipboard APIs require a focused document; emulate focus without showing a window.
    owner.webContents.debugger.attach('1.3');
    owner.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        focusUpdates.push(owner.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }, params.sessionId));
      }
    });
    await owner.webContents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await owner.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const page = documents.create(owner, { html: '<!doctype html><body>Plugin</body>', storageKey: 'same-plugin' });
    const peer = documents.create(owner, { html: '<!doctype html><body>Peer</body>', storageKey: 'same-plugin' });
    let frame = await addFrame(page.url, 'plugin');
    const other = await addFrame(peer.url, 'peer');
    await frame.executeJavaScript('window.focus()');
    assert.deepEqual(await query(frame), ['denied', 'denied', 'denied', 'denied']);
    assert.equal(await readClipboard(frame), 'NotAllowedError');
    assert.equal(prompts, 1, 'clipboard reads require native approval');
    assert.equal(await frame.executeJavaScript(`navigator.mediaDevices.getUserMedia({video:true}).then(() => 'unexpected', error => error.name)`, true), 'NotAllowedError');
    assert.equal(await frame.executeJavaScript(`new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve(0), error => resolve(error.code)))`), 1);
    assert.equal(prompts, 3, 'camera and location cannot bypass the permission request handler');

    response = 1;
    assert.equal(await readClipboard(frame), 'read');
    assert.deepEqual(await query(frame), ['denied', 'denied', 'denied', 'granted']);
    assert.deepEqual(await query(other), ['denied', 'denied', 'denied', 'denied'], 'a shared storage origin does not share grants');
    assert.equal(await readClipboard(frame), 'read');
    assert.equal(prompts, 4);
    const reloaded = new Promise<void>(resolve => owner.webContents.once('did-frame-finish-load', () => resolve()));
    await owner.webContents.executeJavaScript(`document.querySelector('iframe[name="plugin"]').src = ${JSON.stringify(page.url)}`);
    await reloaded;
    frame = await until(() => owner.webContents.mainFrame.frames.find(value => value.name === 'plugin' && value.url === page.url));
    assert.deepEqual(await query(frame), ['denied', 'denied', 'denied', 'denied'], 'reload revokes the old document');
    assert.equal(await readClipboard(frame), 'read');
    assert.equal(prompts, 5);
    documents.release(owner.webContents.id, page.id);
    assert.deepEqual(await query(frame), ['denied', 'denied', 'denied', 'denied'], 'release revokes the live frame');
    assert.equal(await readClipboard(frame), 'NotAllowedError');
    assert.equal(prompts, 5);

    await session.defaultSession.protocol.handle('https', () => new Response('<!doctype html><body>Remote</body>',
      { headers: { 'Content-Type': 'text/html' } }));
    await owner.webContents.executeJavaScript(`document.querySelector('iframe[name="plugin"]').src = 'https://remote.test/'`);
    const remote = await until(() => owner.webContents.mainFrame.frames.find(value => value.url === 'https://remote.test/'));
    assert.deepEqual(await query(remote), ['denied', 'denied', 'denied', 'denied']);
    assert.equal(await readClipboard(remote), 'NotAllowedError');
    assert.equal(prompts, 5);
    console.log('PLUGIN_UI_PERMISSIONS_OK');
  } finally { owner.destroy(); }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
