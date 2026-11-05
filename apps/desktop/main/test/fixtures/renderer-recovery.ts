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
// Fail visibly instead of waiting behind Electron's default synchronous error dialog.
process.on('uncaughtException', (error) => { console.error(error); app.exit(1); });
let phase = 'waiting for app readiness';
const mark = (value: string) => { phase = value; console.log(`RENDERER_RECOVERY_PHASE ${value}`); };
const watchdog = setTimeout(() => { console.error(`Renderer recovery fixture stalled: ${phase}`); app.exit(1); }, 15_000);
app.once('quit', () => clearTimeout(watchdog));

void app.whenReady().then(async () => {
  const root = process.argv[2]!;
  const scenario = process.argv[3]!;
  assert.ok(['load-and-close', 'recovery'].includes(scenario));
  await mkdir(path.join(root, 'dist/renderer'), { recursive: true });
  const entry = path.join(root, 'dist/renderer/index.html');
  await writeFile(entry, '<!doctype html><title>Recovery fixture</title><body>Ready</body>');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const contents = window.webContents;
  const killRenderer = () => {
    const pid = contents.getOSProcessId();
    assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid, 'fault injection must only target the renderer helper');
    process.kill(pid, 'SIGKILL');
  };
  let prepared = 0;
  let loaded = 0;
  contents.on('did-finish-load', () => { loaded += 1; });
  mark('loading initial document');
  await loadDesktopRenderer(window, { appRoot: root, prepare: async () => { prepared += 1; } });
  assert.equal(loaded, 1);
  if (scenario === 'load-and-close') {
    window.show();
    await delay(1_200);
  } else {
    mark('terminating hidden renderer');
    const gone = once(contents, 'render-process-gone');
    killRenderer();
    await gone;
    assert.equal(window.isDestroyed(), false);
    assert.equal(contents.isDestroyed(), false);
    await delay(1_200);
    assert.equal(loaded, 1, 'hidden windows must not reload in the background');
    const restored = once(contents, 'did-finish-load');
    mark('revealing lost renderer');
    window.show();
    await restored;
    assert.equal(await contents.executeJavaScript('document.title'), 'Recovery fixture');
    assert.equal(loaded, 2);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      mark(`terminating renderer ${attempt}`);
      const nextGone = once(contents, 'render-process-gone');
      killRenderer();
      await nextGone;
      if (attempt === 2) {
        const nextRestored = once(contents, 'did-finish-load');
        await nextRestored;
        assert.equal(loaded, 3);
      } else {
        window.focus();
        await delay(1_500);
        assert.equal(loaded, 3, 'automatic recovery must stop after two attempts');
        // Leave a healthy document for orderly fixture disposal after budget assertions.
        await window.loadFile(entry);
      }
    }
  }
  assert.equal(prepared, 1, 'renderer recovery must not prepare native services again');
  mark('closing fixture window');
  const destroyed = once(contents, 'destroyed');
  window.destroy();
  await destroyed;
  console.log(`RENDERER_RECOVERY_OK ${scenario}`);
  app.quit();
}).catch((error: unknown) => { console.error(error); app.exit(1); });
