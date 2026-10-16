import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, type WebContents } from 'electron';
import { DesktopBrowserController } from '../../src/main/control.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('site-per-process');
app.disableHardwareAcceleration();
app.dock?.hide();

async function main() {
  const timeout = setTimeout(() => { console.error('Media capture fixture timed out'); app.exit(1); }, 25_000);
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Capture fixture</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const controller = new DesktopBrowserController();
  try {
    await owner.loadURL('data:text/html,<!doctype html><body></body>');
    const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.webContents.executeJavaScript(`(() => { const view = document.createElement('webview');
      view.src = 'http://127.0.0.1:${port}/'; document.body.append(view); })()`);
    const guest = await attached;
    if (guest.isLoading()) await once(guest, 'did-finish-load');
    controller.registerTab('capture', guest);
    // Device mode owns the debugger attachment before any automation or sleep inspection.
    assert.equal(await controller.setDeviceEmulation('capture', {
      width: 390, height: 844, deviceScaleFactor: 2, scale: 1, mobile: true, userAgentProfile: 'ios-phone',
    }), true);
    assert.equal(guest.debugger.isAttached(), true);
    await guest.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const recorder = new MediaRecorder(stream);
      recorder.start();
      window.recordingState = () => ({ state: recorder.state, live: stream.getTracks().some(track => track.readyState === 'live') });
      window.stopRecording = () => { recorder.stop(); stream.getTracks().forEach(track => track.stop()); };
    })()`);
    assert.deepEqual(await guest.executeJavaScript('window.recordingState()'), { state: 'recording', live: true });
    assert.equal(await guest.executeJavaScript('document.querySelectorAll("audio,video").length'), 0);
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: false, blocker: 'media' });
    assert.deepEqual(await guest.executeJavaScript('window.recordingState()'), { state: 'recording', live: true });
    await guest.executeJavaScript('window.stopRecording()');
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: true }, 'stopped microphone permits sleep');
    await controller.setPageSuspended('capture', owner.webContents.id, false);

    // A disabled live camera track still represents an ongoing capture session.
    await guest.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      window.camera = stream.getVideoTracks()[0]; window.camera.enabled = false;
    })()`);
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: false, blocker: 'media' });
    await guest.executeJavaScript('window.camera.stop()');

    await guest.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.allow = 'microphone; camera';
      frame.onload = () => resolve(null); frame.src = 'http://localhost:${port}/child'; document.body.append(frame);
    })`);
    if (guest.isLoading()) await once(guest, 'did-stop-loading');
    const child = guest.mainFrame.framesInSubtree.find(frame => frame.url.endsWith('/child'))!;
    assert.ok(child);
    assert.notEqual(child.osProcessId, guest.getOSProcessId(), 'the child capture must run in a different process');
    await child.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      window.clone = stream.getAudioTracks()[0].clone(); stream.getTracks().forEach(track => track.stop());
    })()`);
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: false, blocker: 'media' });
    await child.executeJavaScript('window.clone.stop()');
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: true }, 'stopped child capture permits sleep');
    await controller.setPageSuspended('capture', owner.webContents.id, false);
    // Navigation must not leave a stale media block on the replacement document.
    await guest.loadURL(`http://127.0.0.1:${port}/next`);
    if (guest.isLoading()) await once(guest, 'did-stop-loading');
    assert.deepEqual(await controller.setPageSuspended('capture', owner.webContents.id, true), { suspended: true }, 'navigation clears old capture state');
    console.log('PAGE_SLEEP_OK');
  } finally {
    controller.clear(); owner.destroy(); server.close(); clearTimeout(timeout);
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
