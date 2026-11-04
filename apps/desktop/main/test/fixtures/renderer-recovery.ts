import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadDesktopRenderer } from '../../src/window/renderer-loading.js';

app.setPath('userData', path.join(process.argv[2]!, 'profile'));
app.disableHardwareAcceleration();
app.dock?.hide();
app.on('window-all-closed', () => undefined);
let phase = 'waiting for app readiness';
const mark = (value: string) => { phase = value; console.log(`RENDERER_RECOVERY_PHASE ${value}`); };
const watchdog = setTimeout(() => { console.error(`Renderer recovery fixture stalled: ${phase}`); app.exit(1); }, 15_000);
app.once('quit', (_event, code) => {
  clearTimeout(watchdog);
  console.log('RENDERER_RECOVERY_QUIT', code, process.getActiveResourcesInfo());
});

void app.whenReady().then(async () => {
  const root = process.argv[2]!;
  const scenario = process.argv[3]!;
  assert.ok(['baseline', 'loaded-baseline', 'manual-loss', 'recovery'].includes(scenario));
  await mkdir(path.join(root, 'dist/renderer'), { recursive: true });
  const entry = path.join(root, 'dist/renderer/index.html');
  await writeFile(entry, '<!doctype html><title>Recovery fixture</title><body>Ready</body>');
  mark(`creating ${scenario} window`);
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const state = () => ({ visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() });
  window.on('show', () => console.log('RENDERER_RECOVERY_WINDOW show', state()));
  window.on('focus', () => console.log('RENDERER_RECOVERY_WINDOW focus', state()));
  window.on('closed', () => console.log('RENDERER_RECOVERY_WINDOW closed'));
  window.webContents.on('destroyed', () => console.log('RENDERER_RECOVERY_CONTENTS destroyed'));
  let prepared = 0;
  let loaded = 0;
  window.webContents.on('did-finish-load', () => { loaded += 1; });
  mark('loading initial document');
  const managed = scenario === 'recovery' || scenario === 'loaded-baseline';
  if (managed) await loadDesktopRenderer(window, { appRoot: root, prepare: async () => { prepared += 1; } });
  else await window.loadFile(entry);
  assert.equal(loaded, 1);
  if (scenario === 'baseline' || scenario === 'loaded-baseline') {
    window.show();
    await delay(1_200);
  } else {
    mark('terminating hidden renderer');
    const gone = once(window.webContents, 'render-process-gone');
    const pid = window.webContents.getOSProcessId();
    assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid, 'fault injection must only target the renderer helper');
    process.kill(pid, 'SIGKILL');
    await gone;
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.webContents.isDestroyed(), false);
    await delay(1_200);
    assert.equal(loaded, 1, 'hidden windows must not reload in the background');
    const restored = once(window.webContents, 'did-finish-load');
    mark('revealing lost renderer');
    window.show();
    if (scenario === 'manual-loss') { await delay(1_000); await window.loadFile(entry); }
    await restored;
    mark('checking restored document');
    assert.equal(await window.webContents.executeJavaScript('document.title'), 'Recovery fixture');
    assert.equal(loaded, 2);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      mark(`terminating renderer ${attempt}`);
      const nextGone = once(window.webContents, 'render-process-gone');
      const nextPid = window.webContents.getOSProcessId();
      assert.ok(Number.isSafeInteger(nextPid) && nextPid > 0 && nextPid !== process.pid);
      process.kill(nextPid, 'SIGKILL');
      await nextGone;
      if (attempt === 2) {
        const nextRestored = once(window.webContents, 'did-finish-load');
        if (scenario === 'manual-loss') { await delay(1_000); await window.loadFile(entry); }
        await nextRestored;
        assert.equal(loaded, 3);
      } else {
        await delay(1_500);
        assert.equal(loaded, 3, 'automatic recovery must stop after two attempts');
        mark('restoring document for cleanup');
        await window.loadFile(entry);
      }
    }
  }
  assert.equal(prepared, managed ? 1 : 0);
  console.log(`RENDERER_RECOVERY_OK ${scenario}`);
  mark('exiting fixture');
  app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
