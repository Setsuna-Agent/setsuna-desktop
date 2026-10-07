import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';
import { installEmbeddedBrowserWebviews } from '../../src/main/webview.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration(); app.dock?.hide();
BrowserWindow.prototype.show = () => undefined;
BrowserWindow.prototype.showInactive = () => undefined;

async function until<T>(read: () => Promise<T> | T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

function acknowledgement(channel: string, guest: WebContents, url: string, extensionId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ipcMain.off(channel, receive); reject(new Error(`No acknowledgement: ${channel}`)); }, 8000);
    const receive = (event: Electron.IpcMainEvent, value?: { extensionId?: string }) => {
      if (event.sender !== guest || event.senderFrame?.url !== url || extensionId && value?.extensionId !== extensionId) return;
      ipcMain.off(channel, receive); clearTimeout(timer); resolve();
    };
    ipcMain.on(channel, receive);
  });
}

async function writeExtension(storagePath: string, name: string): Promise<string> {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const root = path.join(storagePath, 'Extensions', id, '1.0_0');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0', key: key.toString('base64'),
    permissions: ['storage', 'userScripts'], host_permissions: ['https://scripts.test/*', 'http://127.0.0.1/*'], background: { service_worker: 'worker.js' } }));
  await writeFile(path.join(root, 'control.html'), '<!doctype html><title>Control</title>');
  await writeFile(path.join(root, 'worker.js'), `chrome.runtime.onUserScriptConnect.addListener(port => {
    port.onMessage.addListener(message => port.postMessage({context:'worker',message}));
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message === 'ready') respond({allowed:!!chrome.userScripts});
  });`);
  return id;
}

const api = (control: BrowserWindow, method: string, args: unknown[]) => control.webContents.executeJavaScript(
  `chrome.userScripts[${JSON.stringify(method)}](...${JSON.stringify(args)})`);

async function main() {
  await app.whenReady();
  const holds = new Map<string, ServerResponse>();
  const server = createServer((request, response) => {
    const key = request.url!.split('/').at(-1)!;
    if (request.url!.startsWith('/hold/')) { holds.set(key, response); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><head><script src="/hold/${key}"></script></head><body>Blocked parser</body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const firstId = await writeExtension(browserSession.storagePath!, 'Attacker');
  const secondId = await writeExtension(browserSession.storagePath!, 'Receiver');
  browserSession.protocol.handle('https', () => new Response('<!doctype html><title>Live</title>', { headers: { 'Content-Type': 'text/html' } }));
  const owner = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true } });
  const controls = [firstId, secondId].map(() => new BrowserWindow({ show: false, webPreferences: { session: browserSession, contextIsolation: true, sandbox: true } }));
  const [first, second] = controls;
  const service = new BrowserExtensionService({ session: browserSession, preloadPath: path.join(directory, 'security-preload.cjs'),
    owner: (contents) => contents.hostWebContents?.id === owner.webContents.id ? owner : null,
    activeOwner: () => owner, language: () => 'en-US', publish: () => undefined, actionsChanged: () => undefined, openWebPage: () => undefined });
  const stopWebviews = installEmbeddedBrowserWebviews({ mainWindow: owner, interfaceLanguage: () => 'en-US',
    activeKeyboardShortcutBindings: () => new Set(), browserTabIdForWebContents: () => null, contextMenus: {} as BrowserContextMenuSession,
    isAllowedExtensionUrl: (url) => service.allowsPage(url), onGuestAttached: (contents) => service.track(contents) });
  try {
    await service.start();
    for (const [index, id] of [firstId, secondId].entries()) {
      assert.equal(await service.setUserScriptsAllowed(id, true), true);
      await controls[index].loadURL(`chrome-extension://${id}/control.html`);
      await until(() => controls[index].webContents.executeJavaScript('!!chrome.userScripts'), 'allowed control');
      await api(controls[index], 'configureWorld', [{ messaging: true }]);
      // Storage survives worker reloads; only a reply proves the current worker is ready.
      await until(() => controls[index].webContents.executeJavaScript('chrome.runtime.sendMessage("ready").then(data => data.allowed)'),
        'worker has installed its connection listener');
    }
    await second.webContents.executeJavaScript(`chrome.runtime.onUserScriptConnect.addListener(port => {
      port.onMessage.addListener(message => port.postMessage({context:'page',message}));
    })`);
    await api(first, 'register', [[{ id: 'attacker', matches: ['https://scripts.test/*'], runAt: 'document_start', js: [{ code: `
      let outbound; const dispatch = document.dispatchEvent.bind(document);
      document.dispatchEvent = event => {
        try { if (JSON.parse(event.detail).kind === 'message') outbound = event.type; } catch {}
        return dispatch(event);
      };
      chrome.runtime.sendMessage('capture-channel').catch(() => {});
      document.addEventListener('forge-response', () => {
        if (!outbound) throw new Error('Own channel not captured');
        for (let token = 1; token <= 16; token++) document.dispatchEvent(new CustomEvent(outbound,
          { detail:JSON.stringify({kind:'response', token, handled:true, responded:true, result:'forged-A'}) }));
        document.documentElement.dataset.forged = 'yes';
      });
      document.documentElement.dataset.attackerReady = 'yes';
    ` }] }]]);
    await api(second, 'register', [[{ id: 'receiver', matches: ['https://scripts.test/*'], runAt: 'document_start', js: [{ code: `
      chrome.runtime.onMessage.addListener((_message, _sender, respond) => {
        document.documentElement.dataset.waiting = 'yes';
        document.addEventListener('release-response', () => respond('legitimate-B'), {once:true}); return true;
      });
      const responses = []; const port = chrome.runtime.connect({name:'fanout'});
      port.onMessage.addListener(response => {
        responses.push(response); document.documentElement.dataset.portResponses = JSON.stringify(responses);
      }); port.postMessage('initial');
      document.documentElement.dataset.receiverReady = 'yes';
    ` }] }]]);
    await api(second, 'configureWorld', [{ worldId: 'no-messaging', messaging: false }]);
    await api(second, 'register', [[{ id: 'no-messaging', worldId: 'no-messaging', matches: ['https://scripts.test/*'], runAt: 'document_start', js: [{ code: `
      document.documentElement.dataset.blockedApis = JSON.stringify(['sendMessage','connect','onMessage','onConnect'].map(key => typeof chrome.runtime[key]));
      chrome.runtime.onMessage?.addListener(() => { document.documentElement.dataset.leakedMessage = 'yes'; });
    ` }] }]]);
    const attached = new Promise<WebContents>((resolve) => owner.webContents.once('did-attach-webview', (_event, contents) => resolve(contents)));
    await owner.loadURL(`data:text/html,<webview partition="${DESKTOP_BROWSER_PARTITION}" src="about:blank"></webview>`);
    const guest = await attached;
    guest.on('console-message', (event) => { if (event.level === 'error') console.error('guest:', event.message); });
    await guest.loadURL('https://scripts.test/live');
    await until(() => guest.executeJavaScript('document.documentElement.dataset.attackerReady && document.documentElement.dataset.receiverReady'),
      'both isolated scripts have installed their listeners');
    assert.deepEqual(JSON.parse(await guest.executeJavaScript('document.documentElement.dataset.blockedApis')), Array(4).fill('undefined'));
    await second.webContents.executeJavaScript(`globalThis.reply = chrome.tabs.sendMessage(${guest.id}, 'await-response'); void 0`);
    await until(() => guest.executeJavaScript('document.documentElement.dataset.waiting'), 'receiver has a pending response');
    await guest.executeJavaScript('document.dispatchEvent(new Event("forge-response")); document.dispatchEvent(new Event("release-response"))');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.forged'), 'yes');
    assert.equal(await second.webContents.executeJavaScript('globalThis.reply'), 'legitimate-B');
    assert.equal(await guest.executeJavaScript('document.documentElement.dataset.leakedMessage'), undefined);
    let received: { context: string; message: string }[] = [];
    const responses = await until(async () => {
      const responses = JSON.parse(await guest.executeJavaScript('document.documentElement.dataset.portResponses || "[]"'));
      received = responses;
      return responses.length >= 2 && responses;
    }, 'both worker and page receive the initial port message').catch(error => { throw new Error(`${error.message}: ${JSON.stringify(received)}`); });
    assert.deepEqual(responses.map((response: { context: string }) => response.context).sort(), ['page', 'worker']);
    assert.ok(responses.every((response: { message: string }) => response.message === 'initial'));

    const stages = ['document_end', 'document_idle'] as const;
    const worlds = ['MAIN', 'USER_SCRIPT'] as const;
    for (const [control, name] of [[first, 'A'], [second, 'B']] as const) {
      await api(control, 'register', [worlds.flatMap(world => stages.map(runAt => ({ id: `${world}-${runAt}`,
        matches: ['http://127.0.0.1/blocked/*'], world, runAt,
        js: [{ code: `document.documentElement.dataset['${name}_${world}_${runAt}'] = 'ran';` }] })))]);
    }
    for (const action of ['revoke', 'disable', 'remove'] as const) {
      const url = `http://127.0.0.1:${address.port}/blocked/${action}`;
      const planned = acknowledgement('fixture:user-scripts-planned', guest, url);
      const loading = guest.loadURL(url);
      // The parser's speculative fetch can reach the server before preload executes.
      await planned;
      await until(() => holds.get(action), 'parser waits before DOMContentLoaded');
      const queued = acknowledgement('fixture:user-scripts-execution', guest, url, firstId);
      const execution = api(first, 'execute', [{ target: { tabId: guest.id }, injectImmediately: false,
        js: [{ code: 'document.documentElement.dataset.queuedExecute = "ran";' }] }]);
      await Promise.race([queued, execution.then(value => { throw new Error(`Execution completed before parser release (${action}): ${JSON.stringify(value)}`); })]);
      const invalidated = acknowledgement('fixture:user-scripts-invalidated', guest, url, firstId);
      if (action === 'revoke') assert.equal(await service.setUserScriptsAllowed(firstId, false), true);
      else if (action === 'disable') assert.equal(await service.setEnabled(firstId, false), true);
      else assert.equal(await service.remove(firstId), true);
      await invalidated;
      holds.get(action)!.end(''); holds.delete(action);
      await loading; await execution;
      const dataset = await until(async () => {
        const data = await guest.executeJavaScript('({...document.documentElement.dataset})');
        return worlds.every(world => stages.every(stage => data[`B_${world}_${stage}`] === 'ran')) && data;
      }, 'unrelated extension still executes both phases');
      assert.equal(dataset.queuedExecute, undefined);
      for (const world of worlds) for (const stage of stages) assert.equal(dataset[`A_${world}_${stage}`], undefined);
      if (action === 'remove') continue;
      assert.equal(await service.setEnabled(firstId, true), true);
      assert.equal(await service.setUserScriptsAllowed(firstId, true), true);
      await first.loadURL(`chrome-extension://${firstId}/control.html`);
      await until(() => first.webContents.executeJavaScript('!!chrome.userScripts'), 'restored control');
      const result = await api(first, 'execute', [{ target: { tabId: guest.id }, injectImmediately: true, js: [{ code: '6 * 7' }] }]);
      assert.equal(result[0].result, 42);
    }
    console.log('USER_SCRIPTS_SECURITY_OK');
  } finally {
    for (const response of holds.values()) response.destroy();
    server.closeAllConnections(); server.close(); service.dispose(); stopWebviews(); owner.destroy();
    for (const control of controls) if (!control.isDestroyed()) control.destroy();
  }
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
