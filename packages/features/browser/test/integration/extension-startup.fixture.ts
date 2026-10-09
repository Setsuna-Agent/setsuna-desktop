import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { provideHostCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { app, session, webContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { browserMainFeature } from '../../src/main/feature.js';
import { browserControlConnectionCapability, browserMainHostCapability } from '../../src/main/capabilities.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';

const directory = process.argv[2]; const phase = process.argv[3];
app.setPath('userData', path.join(directory, 'profile', phase));
app.disableHardwareAcceleration(); app.dock?.hide();

async function until(read: () => boolean | Promise<boolean>, label: string) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    if (await read()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${label}`);
}

async function writeExtension(root: string, name: string, script: string, mv2 = false, scriptUrl?: string) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const location = path.join(root, 'Extensions', id, '1.0.0_0');
  await mkdir(location, { recursive: true });
  await writeFile(path.join(location, 'manifest.json'), JSON.stringify({ manifest_version: mv2 ? 2 : 3, name, version: '1.0.0',
    key: key.toString('base64'), background: mv2 ? scriptUrl ? { page: 'background.html' } : { scripts: ['worker.js'] }
      : { service_worker: 'worker.js' },
    ...(scriptUrl ? { content_security_policy: `script-src 'self' ${new URL(scriptUrl).origin}; object-src 'self'` } : {}),
  }));
  await writeFile(path.join(location, 'worker.js'), script);
  if (scriptUrl) await writeFile(path.join(location, 'background.html'), `<script src="${scriptUrl}"></script>`);
  return id;
}

async function main() {
  await app.whenReady();
  const browser = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  const startupScript = 'globalThis.startupCount = 0; chrome.runtime.onStartup.addListener(() => { globalThis.startupCount++; });';
  let pageResponse: http.ServerResponse | undefined;
  const pageServer = phase === 'pages' ? http.createServer((_request, response) => { pageResponse = response; }) : undefined;
  if (pageServer) { pageServer.listen(0, '127.0.0.1'); await once(pageServer, 'listening'); }
  const pageAddress = pageServer?.address();
  const pageScriptUrl = pageAddress && typeof pageAddress !== 'string' ? `http://127.0.0.1:${pageAddress.port}/gate.js` : undefined;
  const pageId = pageScriptUrl ? await writeExtension(browser.storagePath!, 'Slow MV2 page', startupScript, true, pageScriptUrl) : undefined;
  const broken = await Promise.all((['queue', 'pages'].includes(phase) ? [] : [1, 2]).map(index => writeExtension(browser.storagePath!, `Broken ${index}`,
    'chrome.unimplementedEvent.addListener(() => undefined);')));
  const slow = await Promise.all(Array.from({ length: phase === 'queue' ? 12 : phase === 'pages' ? 0 : 1 }, (_, index) =>
    writeExtension(browser.storagePath!, `Stalled startup ${index}`, 'console.log("stalled fixture loaded");')));
  const healthy = phase === 'queue' ? slow[0]
    : await writeExtension(browser.storagePath!, 'Healthy startup', phase === 'pages' ? startupScript : 'console.log("healthy fixture loaded");', phase === 'pages');
  const preloads = browser.getPreloadScripts().map(({ id }) => id);
  const registrations = browser.serviceWorkers.listenerCount('registration-completed');
  const diagnostics = browser.serviceWorkers.listenerCount('console-message');
  const attempted = new Set<string>(); const failed = new Set<string>();
  const nativeStart = browser.serviceWorkers.startWorkerForScope.bind(browser.serviceWorkers);
  browser.serviceWorkers.startWorkerForScope = scope => {
    const id = new URL(scope).hostname; attempted.add(id);
    return slow.includes(id) ? new Promise(() => undefined) : nativeStart(scope);
  };
  const nativeError = console.error;
  console.error = (...args: unknown[]) => {
    const match = /^Failed to start worker for extension ([a-p]{32})$/.exec(String(args[0]));
    if (match) failed.add(match[1]);
    nativeError(...args);
  };
  let release!: () => void; let loading = false; let loaded = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const nativeLoad = browser.extensions.loadExtension.bind(browser.extensions);
  browser.extensions.loadExtension = async (...args) => {
    loading = true; await gate;
    const extension = await nativeLoad(...args); loaded = true;
    return extension;
  };
  let extensions!: BrowserExtensionService; let scope!: FeatureScope;
  const nativeRestore = BrowserExtensionService.prototype.start;
  BrowserExtensionService.prototype.start = function () { extensions = this; return nativeRestore.call(this); };
  const feature = { ...browserMainFeature, setup(context: Parameters<typeof browserMainFeature.setup>[0]) {
    scope = context.scope; return browserMainFeature.setup(context);
  } };
  const before = performance.now();
  const composition = await defineMainFeatureHost({ required: [feature], optional: [] }).activate({
    hostCapabilities: [provideHostCapability(browserMainHostCapability, {
      extensionPreloadPath: path.join(directory, 'extensions.cjs'),
      passwordStorage: { read: async () => null, write: async () => undefined },
      focusedWindow: () => null, onWindowAdded: () => () => undefined,
      activeKeyboardShortcutBindings: () => new Set(), interfaceLanguage: () => 'en-US',
    })],
  });
  const readyMs = performance.now() - before;
  try {
    const { connection } = composition.resolveHostDependencies({ connection: requiredCapability(browserControlConnectionCapability) });
    const health = await fetch(`${connection.url}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const tabs = await fetch(`${connection.url}/v1/browser/command`, { method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tabs' }) });
    assert.equal(tabs.status, 200); assert.deepEqual(await tabs.json(), { result: { kind: 'tabs', tabs: [] } });
    await until(() => loading, 'background restoration enters native extension loading');
    assert.equal(browser.extensions.getAllExtensions().length, 0);
    console.log(`BROWSER_READY_WITH_RESTORE_PENDING_MS ${readyMs.toFixed(1)}`);
    if (phase === 'dispose') {
      // Model a user operation queued behind restoration, then close before native loading returns.
      const pending = scope.runOperation(() => extensions.setEnabled(healthy, false));
      await Promise.resolve();
      await composition.dispose(); release();
      assert.equal(await pending, false);
      await until(() => browser.getPreloadScripts().length === preloads.length, 'late restoration releases preloads');
      await until(() => loaded && browser.extensions.getAllExtensions().length === 0, 'late native load cannot revive the disposed service');
      assert.equal(browser.extensions.getAllExtensions().length, 0);
      assert.equal(attempted.size, 0);
    } else if (phase === 'queue') {
      release();
      await extensions.start();
      assert.equal(browser.extensions.getAllExtensions().length, 12);
      assert.equal(attempted.size, 4);
      assert.equal(browser.serviceWorkers.listenerCount('registration-completed'), registrations + 4);
      assert.equal(browser.serviceWorkers.listenerCount('console-message'), diagnostics + 4);
      const queued = slow.find(id => !attempted.has(id))!;
      assert.equal(await extensions.setEnabled(queued, false), true);
      const first = [...attempted][0];
      browser.serviceWorkers.emit('console-message', {}, { source: 'javascript', level: 3,
        sourceUrl: `chrome-extension://${first}/worker.js`, message: 'Fixture startup failure.' });
      await until(() => attempted.size === 5, 'a failed worker releases a slot for the next queued worker');
      assert.equal(attempted.has(queued), false);
      await composition.dispose();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(attempted.size, 5);
    } else if (phase === 'pages') {
      release();
      // A network-stalled MV2 document must not hold extension restoration or
      // prevent a healthy background page from receiving its own startup event.
      await extensions.start();
      await until(() => Boolean(pageResponse), 'MV2 background waits for its script');
      const background = (id: string) => webContents.getAllWebContents().find(contents => contents.session === browser
        && contents.getType() === 'backgroundPage' && contents.getURL().startsWith(`chrome-extension://${id}/`));
      assert.equal(background(pageId!)?.isLoadingMainFrame(), true);
      await until(async () => await background(healthy)?.executeJavaScript('globalThis.startupCount === 1') === true,
        'healthy MV2 background startup while another page is still loading');
      const liveHealth = await fetch(`${connection.url}/health`); assert.equal(liveHealth.status, 200);
      pageResponse!.setHeader('Content-Type', 'application/javascript'); pageResponse!.end(startupScript);
      await until(async () => await background(pageId!)?.executeJavaScript('globalThis.startupCount === 1') === true,
        'slow MV2 page receives startup after its script is ready');
      assert.equal(attempted.size, 0);
      await composition.dispose();
    } else {
      release();
      await until(() => attempted.size === 4, 'a stalled worker does not block the other worker starts');
      await until(() => broken.every(id => failed.has(id)), 'uncaught startup errors fail immediately');
      await until(() => Object.values(browser.serviceWorkers.getAllRunning()).some(info => info.scope === `chrome-extension://${healthy}/`),
        'healthy worker still starts');
      assert.equal(failed.has(slow[0]), false);
      await composition.dispose();
    }
    assert.deepEqual(browser.getPreloadScripts().map(({ id }) => id), preloads);
    assert.equal(browser.serviceWorkers.listenerCount('registration-completed'), registrations);
    assert.equal(browser.serviceWorkers.listenerCount('console-message'), diagnostics);
    console.log(`EXTENSION_STARTUP_${phase.toUpperCase()}_OK`);
  } finally {
    release(); await composition.dispose(); console.error = nativeError;
    pageResponse?.end(); pageServer?.closeAllConnections(); pageServer?.close();
  }
}

main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
