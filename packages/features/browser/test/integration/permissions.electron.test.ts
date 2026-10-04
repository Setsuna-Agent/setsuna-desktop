import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

// Request callbacks alone cannot prove that Chromium's subsequent permission queries see the grant.
it.skipIf(!['darwin', 'win32'].includes(process.platform))('keeps native notification permission queries consistent with document-scoped grants', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-permissions-test-'));
  const entry = path.join(directory, 'test.cjs');
  const source = (name: string) => JSON.stringify(fileURLToPath(new URL(`../../src/main/settings/${name}.ts`, import.meta.url)));
  try {
    await build({
      stdin: { contents: `
        import assert from 'node:assert/strict';
        import { app, BrowserWindow, dialog, session } from 'electron';
        import { installBrowserPermissions } from ${source('permissions')};
        import { BrowserPreferencesStore } from ${source('preferences')};
        app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
        app.disableHardwareAcceleration();
        app.dock?.hide();
        async function main() {
          await app.whenReady();
          const browserSession = session.fromPartition('permissions-test');
          browserSession.protocol.handle('https', () => new Response('<!doctype html><title>Permission fixture</title>'));
          const preferences = new BrowserPreferencesStore(${JSON.stringify(path.join(directory, 'preferences.json'))});
          await preferences.update({ permissions: { notifications: 'ask' } });
          const window = new BrowserWindow({ show: false, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true } });
          const guest = window.webContents;
          let prompts = 0;
          dialog.showMessageBox = async () => { prompts++; return { response: 1, checkboxChecked: false }; };
          const dispose = installBrowserPermissions(browserSession, preferences, contents => contents === guest ? window : null, () => 'en-US');
          const status = () => guest.executeJavaScript('Promise.all([Notification.permission, navigator.permissions.query({ name: "notifications" }).then(result => result.state)])');
          const request = () => guest.executeJavaScript('Notification.requestPermission()', true);
          try {
            await guest.loadURL('https://example.test/');
            assert.deepEqual(await status(), ['denied', 'denied'], 'before requesting');
            assert.equal(await request(), 'granted');
            assert.deepEqual(await status(), ['granted', 'granted']);
            assert.equal(await request(), 'granted');
            assert.equal(prompts, 1);
            await guest.executeJavaScript('history.pushState(null, "", "#same-document")');
            assert.deepEqual(await status(), ['granted', 'granted']);

            // Reloading the same URL must invalidate the old document's grant.
            await new Promise(resolve => { guest.once('did-finish-load', resolve); guest.reload(); });
            assert.deepEqual(await status(), ['denied', 'denied'], 'after reload');
            assert.equal(await request(), 'granted');
            assert.equal(prompts, 2);
            await preferences.update({ permissions: { notifications: 'block' } });
            await preferences.update({ permissions: { notifications: 'ask' } });
            assert.deepEqual(await status(), ['denied', 'denied'], 'after policy revocation');
            assert.equal(await request(), 'granted');
            assert.equal(prompts, 3);
            assert.deepEqual(await status(), ['granted', 'granted']);
            console.log('PERMISSION_DOCUMENT_FLOW_OK');
          } finally { dispose(); window.destroy(); }
        }
        main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
      `, loader: 'ts', resolveDir: process.cwd() },
      outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
    });
    const electron = createRequire(import.meta.url)('electron') as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron, [entry], { env, timeout: 25_000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain('PERMISSION_DOCUMENT_FLOW_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
