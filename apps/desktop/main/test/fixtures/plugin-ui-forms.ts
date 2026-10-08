import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { registerMainWindowNavigationGuards } from '../../src/window/navigation.js';

app.setPath('userData', process.argv[2]);
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const submissions: Array<{ method: string; body: string }> = [];
  const server = createServer((request, response) => {
    if (request.url === '/submit' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        submissions.push({ method: request.method!, body });
        response.writeHead(303, { Location: '/complete' });
        response.end();
      });
      return;
    }
    if (request.url === '/complete') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><script>
        let isolated = false;
        try { parent.document.body; } catch { isolated = true; }
        const received = [];
        addEventListener('message', event => received.push(event.data));
        const channel = 'setsuna.sandboxed-ui.v1';
        const connection = new MessageChannel();
        connection.port1.onmessage = event => received.push(event.data);
        parent.postMessage({channel, type:'ready', documentId:'forged'}, '*', [connection.port2]);
        for (const message of [{type:'ready'}, {type:'runtime-request',requestId:'remote',request:{path:'/v1/projects'}},
          {type:'invoke',requestId:'remote',actionId:'todo.add',payload:{}}]) {
          parent.postMessage({channel,...message}, '*');
          connection.port1.postMessage({channel,...message});
        }
        setTimeout(() => parent.postMessage({type:'test-result', isolated, node:typeof process, url:location.href, received}, '*'), 100);
      </script>`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  // Exercise real Chromium form behavior without displaying a window or inspecting styles.
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  owner.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  const externalUrls: string[] = [];
  registerMainWindowNavigationGuards(owner, async (url) => { externalUrls.push(url); });
  try {
    const hostPage = path.join(process.argv[2], 'host.html');
    await writeFile(hostPage, '<!doctype html><html><body></body></html>');
    await owner.loadFile(hostPage);
    await owner.webContents.executeJavaScript(await readFile(process.argv[3], 'utf8'));
    const hostUrl = owner.webContents.getURL();
    const local = await runFrame(owner, {
      html: '<form><input name="title" required><button type="submit">Add</button></form>',
      css: '',
      js: `void window.setsunaUI.ready.then(() => {
        const form = document.querySelector('form');
        const input = form.elements.namedItem('title');
        const button = form.querySelector('button');
        let invalid = 0;
        let submitted = 0;
        form.addEventListener('invalid', () => invalid++, true);
        form.addEventListener('submit', async event => {
          event.preventDefault();
          submitted++;
          await window.setsunaUI.invoke('todo.add', {title:input.value});
          parent.postMessage({type:'test-result', invalid, submitted, title:input.value}, '*');
        });
        button.click();
        input.value = '本地待办';
        button.click();
      });`,
    });
    assert.deepEqual(local, { result: { type: 'test-result', invalid: 1, submitted: 1, title: '本地待办' },
      stats: { actions: 1, runtimeRequests: 0, cancelled: false } });
    assert.equal(submissions.length, 0);

    const remote = await runFrame(owner, {
      html: `<form action="${endpoint}/submit" method="post"><input name="title" value="HTTP 待办"><button type="submit">Submit</button></form>`,
      css: '',
      js: `void window.setsunaUI.ready.then(async () => {
        void window.setsunaUI.runtime.request({path:'/v1/projects'});
        await window.setsunaUI.invoke('todo.add');
        document.querySelector('button').click();
      });`,
    });
    assert.deepEqual(remote, { result: { type: 'test-result', isolated: true, node: 'undefined', url: `${endpoint}/complete`, received: [] },
      stats: { actions: 1, runtimeRequests: 1, cancelled: true } });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].method, 'POST');
    assert.equal(new URLSearchParams(submissions[0].body).get('title'), 'HTTP 待办');
    assert.equal(owner.webContents.getURL(), hostUrl);
    assert.deepEqual(externalUrls, []);
    process.stdout.write('PLUGIN_UI_FORMS_PASSED\n');
  } finally {
    owner.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function runFrame(owner: BrowserWindow, source: RuntimeSandboxedUiSource): Promise<unknown> {
  return owner.webContents.executeJavaScript(`window.forms.run(${JSON.stringify(source)})`);
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
