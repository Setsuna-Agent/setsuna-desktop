import { app, BrowserWindow, protocol } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { registerMainWindowNavigationGuards } from '../../src/window/navigation.js';
import { pluginUiDocumentScheme } from '../../src/window/plugin-ui-documents.js';
import { registerPluginUiDocumentIpc } from '../../src/ipc/plugin-ui-document-ipc.js';
import { desktopWindows } from '../../src/window/registry.js';

protocol.registerSchemesAsPrivileged([pluginUiDocumentScheme]);
app.setPath('userData', process.argv[2]);
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const submissions: Array<{ method: string; body: string }> = [];
  const server = createServer((request, response) => {
    if (request.url === '/api') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      response.end(JSON.stringify({ value: 42 }));
      return;
    }
    if (request.url === '/library.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' });
      response.end('window.remoteLibrary = 7;');
      return;
    }
    if (request.url === '/embedded') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<script>parent.postMessage({embedded:true}, "*")</script>');
      return;
    }
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
  const owner = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    preload: path.join(process.argv[2], 'preload.cjs'),
  } });
  desktopWindows.add(owner);
  registerPluginUiDocumentIpc();
  owner.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  const externalUrls: string[] = [];
  registerMainWindowNavigationGuards(owner, async (url) => { externalUrls.push(url); });
  try {
    const hostPage = path.join(process.argv[2], 'host.html');
    await writeFile(hostPage, '<!doctype html><html><body></body></html>');
    await owner.loadFile(hostPage);
    await owner.webContents.executeJavaScript(await readFile(process.argv[3], 'utf8'));
    const hostUrl = owner.webContents.getURL();
    const indexedState = `async function indexedState(value) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('page-state', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('values');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (value !== undefined) await new Promise((resolve, reject) => {
          const transaction = db.transaction('values', 'readwrite');
          transaction.objectStore('values').put(value, 'draft');
          transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
        });
        return await new Promise((resolve, reject) => {
          const request = db.transaction('values').objectStore('values').get('draft');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    }`;
    const browserApis = await runFrame(owner, {
      html: '<main>Browser capabilities</main>', css: '', js: `${indexedState}
      void window.setsunaUI.ready.then(async () => {
        const api = await fetch('${endpoint}/api').then(response => response.json());
        await new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = '${endpoint}/library.js';
          script.onload = resolve; script.onerror = reject; document.head.append(script);
        });
        const embedded = await new Promise(resolve => {
          const frame = document.createElement('iframe'); frame.src = '${endpoint}/embedded';
          const receive = event => {
            if (event.source !== frame.contentWindow || !event.data?.embedded) return;
            removeEventListener('message', receive); resolve(true);
          };
          addEventListener('message', receive); document.body.append(frame);
        });
        const workerUrl = URL.createObjectURL(new Blob(['onmessage = e => postMessage(e.data + 1)'], {type:'text/javascript'}));
        const worker = new Worker(workerUrl);
        const workerValue = await new Promise((resolve, reject) => {
          worker.onmessage = event => resolve(event.data); worker.onerror = reject; worker.postMessage(4);
        });
        worker.terminate(); URL.revokeObjectURL(workerUrl);
        const before = localStorage.getItem('draft'); localStorage.setItem('draft', 'persisted');
        const indexed = await indexedState('indexed draft');
        let isolated = false; try { parent.document.body; } catch { isolated = true; }
        parent.postMessage({type:'test-result', api:api.value, library:window.remoteLibrary, embedded,
          worker:workerValue, before, indexed, isolated, node:typeof process}, '*');
      }).catch(error => parent.postMessage({type:'test-result', error:String(error)}, '*'));`,
    }, 'browser-apis');
    assert.deepEqual(browserApis, { result: { type: 'test-result', api: 42, library: 7, embedded: true, worker: 5,
      before: null, indexed: 'indexed draft', isolated: true, node: 'undefined' },
      stats: { actions: 0, runtimeRequests: 0, cancelled: false } });
    for (const [storageKey, expected] of [['browser-apis', 'persisted'], ['another-page', null]] as const) {
      const saved = await runFrame(owner, { html: '', css: '', js: `${indexedState}
        void window.setsunaUI.ready.then(async () => parent.postMessage({type:'test-result',
          saved:localStorage.getItem('draft'), indexed:await indexedState()}, '*'));` }, storageKey);
      assert.deepEqual(saved, { result: { type: 'test-result', saved: expected, indexed: expected ? 'indexed draft' : undefined },
        stats: { actions: 0, runtimeRequests: 0, cancelled: false } });
    }
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

function runFrame(owner: BrowserWindow, source: RuntimeSandboxedUiSource, storageKey = 'forms'): Promise<unknown> {
  return owner.webContents.executeJavaScript(`window.forms.run(${JSON.stringify(source)}, ${JSON.stringify(storageKey)})`);
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
