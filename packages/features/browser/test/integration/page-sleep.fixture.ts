import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { app, BrowserWindow, type WebContents } from 'electron';
import { BROWSER_IPC_CHANNELS, type BrowserPageSleepState } from '../../src/contracts/index.js';
import { DesktopBrowserController } from '../../src/main/control.js';

app.setPath('userData', path.join(process.argv[2], 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function createGuest(owner: BrowserWindow): Promise<WebContents> {
  const attached = new Promise<WebContents>(resolve => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
  await owner.webContents.executeJavaScript(`(() => {
    const view = document.createElement('webview');
    view.src = 'data:text/html,' + encodeURIComponent('<!doctype html><title>Resource fixture</title><p>Live page</p>');
    document.body.append(view);
  })()`);
  const contents = await attached;
  await new Promise<void>(resolve => contents.once('did-finish-load', () => resolve()));
  contents.setBackgroundThrottling(false);
  await contents.executeJavaScript(`window.ticks = 0; window.kept = 'preserved';
    setInterval(() => { window.ticks++; const end = performance.now() + 2; while (performance.now() < end) {} }, 20);`);
  return contents;
}

async function samplePageProcesses(pages: WebContents[]) {
  const pids = new Set(pages.map(page => page.getOSProcessId()));
  const previous = new Map(app.getAppMetrics().map(metric => [metric.pid, metric.cpu.cumulativeCPUUsage]));
  const start = performance.now();
  await delay(600);
  const metrics = app.getAppMetrics();
  const elapsed = (performance.now() - start) / 1000;
  return metrics.filter(metric => pids.has(metric.pid)).map(metric => {
    const before = previous.get(metric.pid);
    const current = metric.cpu.cumulativeCPUUsage;
    return { pid: metric.pid, cpu: before === undefined || current === undefined ? null : Number(((current - before) / elapsed * 100).toFixed(1)),
      memoryKiB: metric.memory.workingSetSize };
  });
}

async function main() {
  const timeout = setTimeout(() => { console.error('Page sleep fixture timed out'); app.exit(1); }, 25_000);
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const states: BrowserPageSleepState[] = [];
  const send = owner.webContents.send.bind(owner.webContents);
  owner.webContents.send = (channel, ...args) => {
    if (channel === BROWSER_IPC_CHANNELS.pageSleepStateChanged) states.push(args[0]);
    send(channel, ...args);
  };
  const controller = new DesktopBrowserController();
  try {
    await owner.loadURL('data:text/html,<!doctype html><body></body>');
    const first = await createGuest(owner);
    const second = await createGuest(owner);
    controller.registerTab('first', first);
    controller.registerTab('second', second, 'current-tab');
    const before = await samplePageProcesses([first, second]);
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id + 99, true)).blocker, 'unavailable');
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).suspended, true);
    assert.equal((await controller.setPageSuspended('second', owner.webContents.id, true)).suspended, true);
    await owner.webContents.executeJavaScript('document.querySelectorAll("webview").forEach(view => view.style.visibility = "hidden")');
    assert.equal(await controller.setAnnotationMarkers('first', owner.webContents.id, { ids: [], visible: false }), false);
    assert.equal(await controller.getAnnotationAnchor('first', owner.webContents.id, 'missing'), null);
    // Reading through CDP does not resume scheduled page tasks.
    const ticks = async (page: WebContents) => (await page.debugger.sendCommand('Runtime.evaluate', { expression: 'window.ticks', returnByValue: true })).result.value;
    const frozenTicks = await ticks(first);
    const after = await samplePageProcesses([first, second]);
    assert.equal(await ticks(first), frozenTicks, 'timers must stop while frozen');
    await controller.execute({ kind: 'snapshot', tabId: 'first' });
    assert.equal(first.getBackgroundThrottling(), false, 'wake restores the previous scheduler policy');
    assert.equal(controller.getPageSleepState('first', owner.webContents.id)?.suspended, false);
    assert.equal(await first.executeJavaScript('window.kept'), 'preserved');
    await owner.webContents.executeJavaScript('document.querySelector("webview").style.visibility = "visible"');
    await delay(100);
    assert.ok(await ticks(first) > frozenTicks, 'timers resume after a browser operation');
    assert.equal(controller.getPageSleepState('second', owner.webContents.id)?.suspended, true);

    // Rebinding a retained guest must not inherit an orphaned frozen state.
    assert.deepEqual(states.filter(state => state.tabId === 'second').at(-1), { tabId: 'second', suspended: true });
    controller.unregisterTab('second');
    controller.registerTab('second', second, 'current-tab');
    assert.deepEqual(states.filter(state => state.tabId === 'second').at(-1), { tabId: 'second', suspended: false },
      're-registration must clear the renderer sleep projection');
    assert.deepEqual(await controller.setPageSuspended('second', owner.webContents.id, false), { suspended: false });
    await owner.webContents.executeJavaScript('document.querySelectorAll("webview")[1].style.visibility = "visible"');
    const reboundTicks = await second.executeJavaScript('window.ticks');
    await delay(100);
    assert.ok(await second.executeJavaScript('window.ticks') > reboundTicks, 'rebound guest resumes execution');
    assert.equal(second.getBackgroundThrottling(), false, 'unregister restores the previous scheduler policy');

    await first.executeJavaScript(`const root = document.createElement('div'); document.body.append(root);
      root.attachShadow({mode:'open'}).innerHTML = '<input value="unsaved">';`);
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).blocker, 'unsaved');
    await first.executeJavaScript('document.querySelector("div").remove()');
    await first.executeJavaScript(`new Promise(resolve => { const frame = document.createElement('iframe');
      frame.onload = () => resolve(null); frame.src = 'data:text/html,<input value="frame draft">'; document.body.append(frame); })`);
    if (first.isLoading()) await once(first, 'did-stop-loading');
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).blocker, 'unsaved');
    await first.executeJavaScript('document.querySelector("iframe").remove()');
    // Muted video must also prevent sleep, even though Electron does not report it as audible.
    await first.executeJavaScript(`const canvas = document.createElement('canvas');
      const video = document.createElement('video'); video.muted = true; document.body.append(video);
      video.srcObject = canvas.captureStream(10); window.fixtureVideo = video;
      canvas.getContext('2d').fillRect(0, 0, 10, 10); video.play(); null`, true);
    await delay(150);
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).blocker, 'media');
    await first.executeJavaScript('window.fixtureVideo.pause(); window.fixtureVideo.srcObject.getTracks().forEach(track => track.stop()); window.fixtureVideo.remove()');

    const work = controller.execute({ kind: 'wait', tabId: 'first', timeoutMs: 100 });
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).blocker, 'busy');
    await work;
    assert.equal((await controller.setPageSuspended('first', owner.webContents.id, true)).suspended, true);
    assert.equal(await controller.reloadTab('first', 'normal'), true);
    assert.equal(controller.getPageSleepState('first', owner.webContents.id)?.suspended, false);
    assert.equal((await controller.setPageSuspended('second', owner.webContents.id, true)).suspended, true);
    const gone = once(second, 'render-process-gone');
    second.forcefullyCrashRenderer();
    await gone;
    assert.equal(controller.getPageSleepState('second', owner.webContents.id)?.suspended, false);
    assert.equal(second.getBackgroundThrottling(), false, 'terminated pages release the frozen scheduling policy');
    const reloaded = once(second, 'did-finish-load');
    assert.equal(await controller.reloadTab('second', 'normal'), true);
    await reloaded;
    assert.equal(second.isCrashed(), false, 'terminated pages remain reloadable');
    console.log(JSON.stringify({ before, after }));
    console.log('PAGE_SLEEP_OK');
  } finally {
    controller.clear(); owner.destroy(); clearTimeout(timeout);
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
