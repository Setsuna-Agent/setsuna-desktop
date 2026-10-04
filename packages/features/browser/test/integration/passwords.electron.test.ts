import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const supported = process.platform === 'darwin' || process.platform === 'win32';

// A hidden native window verifies isolated-world serialization and navigation timing;
// DOM mocks cannot establish whether a submitted password reaches main before a redirect.
it.skipIf(!supported).each(['standard', 'dynamic-widget'])('captures %s login navigation and fills, updates and deletes saved logins', async (variant) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-password-test-'));
  const entry = path.join(directory, 'test.cjs');
  const source = (name: string) => JSON.stringify(fileURLToPath(new URL(`../../src/main/passwords/${name}.ts`, import.meta.url)));
  // Baidu's public login widget uses unnamed display:none inputs before its real
  // username/password fields, autocomplete=off and an input[type=submit].
  const loginMarkup = variant === 'standard'
    ? '<form action="/done" method="post"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>'
    : '<section style="display:none"><form autocomplete="off"><input type="text" style="display:none"><input name="username"><input type="password" style="display:none"><input name="password" type="password"><input type="submit" value="登录"></form></section><script>document.querySelector("form").addEventListener("submit", event => { event.preventDefault(); document.querySelector("[name=password]").value = ""; location.href = "/done"; });</script>';
  try {
    await build({
      stdin: { contents: `
        import { app, BrowserWindow } from 'electron';
        import { createServer } from 'node:http';
        import assert from 'node:assert/strict';
        import { BrowserPasswordSession } from ${source('session')};
        import { BrowserPasswordStore } from ${source('store')};
        app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
        app.disableHardwareAcceleration();
        app.dock?.hide();
        async function until(read, label) {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const result = await read();
            if (result) return result;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          throw new Error('Timed out: ' + label);
        }
        async function main() {
          await app.whenReady();
          const server = createServer((request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(request.url === '/done' ? '<p>Signed in</p>' : ${JSON.stringify(loginMarkup)});
          });
          await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
          const origin = 'http://127.0.0.1:' + server.address().port;
          let raw;
          const store = new BrowserPasswordStore({ read: async () => raw, write: async value => { raw = value; } });
          await store.save(origin, { username: 'alice', password: 'initial' });
          const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
          const guest = window.webContents;
          await guest.loadURL(origin + '/login');
          const session = new BrowserPasswordSession('native-test', guest, store);
          const field = name => guest.executeJavaScript('document.querySelector("[name=' + name + ']")?.value');
          const reveal = () => guest.executeJavaScript('document.querySelector("section")?.removeAttribute("style")');
          const loadLogin = async () => { await guest.loadURL(origin + '/login'); await reveal(); };
          try {
            await reveal();
            await until(async () => (await field('password')) === 'initial', 'automatic fill');
            assert.equal(await field('username'), 'alice');
            assert.equal(await guest.executeJavaScript('Array.from(document.querySelectorAll("input:not([name])")).filter(input => input.type !== "submit").every(input => input.value === "")'), true);
            await guest.executeJavaScript('document.querySelector("[name=password]").value = "updated"; document.querySelector("[name=password]").focus();');
            if (${JSON.stringify(variant)} === 'dynamic-widget') {
              const point = await guest.executeJavaScript('(() => { const rect = document.querySelector("[type=submit]").getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()');
              guest.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
              guest.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
            } else {
              guest.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
              guest.sendInputEvent({ type: 'char', keyCode: '\\r' });
              guest.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            }
            const prompt = await until(async () => (await session.getState()).prompt, 'save prompt after native submit');
            await until(() => guest.getURL() === origin + '/done', 'form navigation');
            assert.equal(prompt.update, true);
            assert.equal((await store.list(origin))[0].password, 'initial');
            assert.equal(await session.save(prompt.id), true);
            assert.equal((await store.list(origin))[0].password, 'updated');
            await loadLogin();
            await until(async () => (await field('password')) === 'updated', 'updated password fill');
            await store.save(origin, { username: 'bob', password: 'second' });
            await loadLogin();
            await until(async () => (await session.getState()).logins.length === 2, 'multiple accounts');
            assert.equal(await field('password'), '');
            const bob = (await store.list(origin)).find(login => login.username === 'bob');
            assert.equal(await session.fill(bob.id), true);
            assert.equal(await field('username'), 'bob');
            assert.equal(await field('password'), 'second');
            for (const login of await store.list(origin)) assert.equal(await session.delete(login.id), true);
            await loadLogin();
            assert.equal(await field('password'), '');
            assert.equal((await store.list(origin)).length, 0);
            console.log('PASSWORD_FLOW_OK');
          } finally {
            session.dispose();
            window.destroy();
            server.close();
          }
        }
        main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
      `, loader: 'ts', resolveDir: process.cwd() },
      outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
    });
    const electron = createRequire(import.meta.url)('electron') as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron, [entry], { env, timeout: 25_000, maxBuffer: 1024 * 1024 });
    expect(stdout).toContain('PASSWORD_FLOW_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
