import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { app, BrowserWindow, webContents, type WebContents } from 'electron';
import { projectDesktopResources, terminateResourceProcess } from '../../src/main/resources.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();

async function createGuest(owner: BrowserWindow): Promise<WebContents> {
  const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
  await owner.webContents.executeJavaScript(`(() => {
    const view = document.createElement('webview');
    view.partition = 'resource-fixture-' + document.querySelectorAll('webview').length;
    view.src = 'data:text/html,' + encodeURIComponent('<!doctype html><title>Resource fixture</title><p>Live page</p>');
    document.body.append(view);
  })()`);
  const contents = await attached;
  if (contents.isLoading()) await once(contents, 'did-finish-load');
  return contents;
}

async function main() {
  const timeout = setTimeout(() => { console.error('Resource fixture timed out'); app.exit(1); }, 25_000);
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const spare = new BrowserWindow({ show: false });
  try {
    await owner.loadURL('data:text/html,<!doctype html><body></body>');
    const guest = await createGuest(owner);
    const second = await createGuest(owner);
    const isRendererSender = (id: number) => id === owner.webContents.id || id === spare.webContents.id;
    const snapshot = projectDesktopResources(app.getAppMetrics(), webContents.getAllWebContents(), isRendererSender);
    const target = snapshot.processes.find(process => process.pid === guest.getOSProcessId());
    assert.ok(target?.canTerminate, 'a loaded guest must be terminable');
    assert.deepEqual(target.pages.map(page => page.id), [guest.id], 'the host must not be counted as a guest process member');
    assert.equal(snapshot.processes.find(process => process.pid === owner.webContents.getOSProcessId())?.canTerminate, false);
    const gone = once(guest, 'render-process-gone');
    assert.equal(terminateResourceProcess(app.getAppMetrics(), webContents.getAllWebContents(), isRendererSender, {
      pid: target.pid, startedAt: target.startedAt, pageIds: target.pages.map(page => page.id),
    }), 'terminated');
    await gone;
    assert.equal(guest.isCrashed(), true);
    assert.equal(owner.webContents.isCrashed(), false);
    assert.equal(await owner.webContents.executeJavaScript('1 + 1'), 2);
    assert.equal(await second.executeJavaScript('1 + 1'), 2);
    const after = projectDesktopResources(app.getAppMetrics(), webContents.getAllWebContents(), isRendererSender);
    const secondTarget = after.processes.find(process => process.pid === second.getOSProcessId());
    assert.ok(secondTarget?.canTerminate, 'a terminated guest must not disable termination of other pages');
    const secondGone = once(second, 'render-process-gone');
    assert.equal(terminateResourceProcess(app.getAppMetrics(), webContents.getAllWebContents(), isRendererSender, {
      pid: secondTarget.pid, startedAt: secondTarget.startedAt, pageIds: secondTarget.pages.map(page => page.id),
    }), 'terminated');
    await secondGone;
    const reloaded = once(guest, 'did-finish-load');
    guest.reload();
    await reloaded;
    assert.equal(guest.isCrashed(), false);
    console.log('RESOURCES_OK');
  } finally { owner.destroy(); spare.destroy(); clearTimeout(timeout); }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
