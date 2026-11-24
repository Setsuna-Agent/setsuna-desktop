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
import { app, session, type WebContents } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { browserMainFeature } from '../../src/main/feature.js';
import { browserControlConnectionCapability, browserMainHostCapability } from '../../src/main/capabilities.js';
import { BrowserExtensionService } from '../../src/main/extensions/service.js';

const directory = process.argv[2]; const phase = process.argv[3];
// Keep evidence even when the parent terminates a stuck native call.
const trace = (stage: string, details: unknown) => console.log('EXTENSION_STARTUP_EVENT',
  JSON.stringify({ phase, ms: Math.round(performance.now()), stage, details }));
app.setPath('userData', path.join(directory, 'profile', phase));
app.disableHardwareAcceleration(); app.dock?.hide();

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
  const startupScript = 'chrome.runtime.onStartup.addListener(() => console.log("fixture profile started"));';
  const scriptRequest = Promise.withResolvers<http.ServerResponse>();
  const pageServer = phase === 'pages' ? http.createServer((_request, response) => scriptRequest.resolve(response)) : undefined;
  if (pageServer) { pageServer.listen(0, '127.0.0.1'); await once(pageServer, 'listening'); }
  const pageAddress = pageServer?.address();
  const pageScriptUrl = pageAddress && typeof pageAddress !== 'string' ? `http://127.0.0.1:${pageAddress.port}/gate.js` : undefined;
  const pageId = pageScriptUrl ? await writeExtension(browser.storagePath!, 'Slow MV2 page', startupScript, true, pageScriptUrl) : undefined;
  const extensionId = pageId
    ? await writeExtension(browser.storagePath!, 'Healthy MV2 page', startupScript, true)
    : await writeExtension(browser.storagePath!, 'Restored worker', phase === 'worker-error' ? 'throw new Error("fixture startup failure");' : '');
  const healthyPageStarted = Promise.withResolvers<void>();
  const slowPageStarted = Promise.withResolvers<void>();
  const observePage = (_event: Electron.Event, contents: WebContents) => {
    if (contents.session !== browser || contents.getType() !== 'backgroundPage') return;
    contents.on('console-message', ({ message }) => {
      if (message !== 'fixture profile started') return;
      const id = new URL(contents.getURL()).hostname;
      if (id === extensionId) healthyPageStarted.resolve();
      if (id === pageId) slowPageStarted.resolve();
    });
  };
  if (pageId) app.on('web-contents-created', observePage);
  const scriptError = Promise.withResolvers<string>();
  const observeError = (_event: Electron.Event, details: Electron.MessageDetails) => {
    if (details.source === 'javascript' && details.level === 3 && details.sourceUrl === `chrome-extension://${extensionId}/worker.js`) {
      trace('worker script error', details.message);
      scriptError.resolve(details.message);
    }
  };
  browser.serviceWorkers.on('console-message', observeError);
  const preloads = browser.getPreloadScripts().map(({ id }) => id);
  const registrations = browser.serviceWorkers.listenerCount('registration-completed');
  const diagnostics = browser.serviceWorkers.listenerCount('console-message');
  let workerAttempts = 0;
  const nativeStart = browser.serviceWorkers.startWorkerForScope.bind(browser.serviceWorkers);
  browser.serviceWorkers.startWorkerForScope = scope => {
    workerAttempts++;
    return nativeStart(scope);
  };
  const nativeError = console.error;
  const reportedError = Promise.withResolvers<Error>();
  console.error = (...args: unknown[]) => {
    if (args[0] === `Failed to start worker for extension ${extensionId}` && args[1] instanceof Error) reportedError.resolve(args[1]);
    nativeError(...args);
  };
  const loading = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const nativeLoad = browser.extensions.loadExtension.bind(browser.extensions);
  browser.extensions.loadExtension = async (...args) => {
    loading.resolve(); await gate.promise;
    trace('loadExtension', args[0]);
    const extension = await nativeLoad(...args);
    // Exercise the native diagnostic before the scheduler starts its bounded attempt.
    if (phase === 'worker-error') await scriptError.promise;
    trace('load-returned', extension.id);
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
    await loading.promise;
    const restoration = extensions.start();
    const pendingDisable = phase === 'dispose' ? scope.runOperation(() => extensions.setEnabled(extensionId, false)) : undefined;
    const { connection } = composition.resolveHostDependencies({ connection: requiredCapability(browserControlConnectionCapability) });
    const health = await fetch(`${connection.url}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const tabs = await fetch(`${connection.url}/v1/browser/command`, { method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tabs' }) });
    assert.equal(tabs.status, 200); assert.deepEqual(await tabs.json(), { result: { kind: 'tabs', tabs: [] } });
    assert.equal(browser.extensions.getAllExtensions().length, 0);
    console.log(`BROWSER_READY_WITH_RESTORE_PENDING_MS ${readyMs.toFixed(1)}`);
    if (phase === 'dispose') {
      const unloaded = once(browser.extensions, 'extension-unloaded');
      await composition.dispose();
      assert.equal(await pendingDisable, false);
      gate.resolve();
      const [, extension] = await unloaded;
      assert.equal(extension.id, extensionId);
      await restoration;
      assert.equal(browser.extensions.getAllExtensions().length, 0);
    } else if (phase === 'pages') {
      gate.resolve();
      // A network-stalled MV2 document must not hold extension restoration or
      // prevent a healthy background page from receiving its own startup event.
      await restoration;
      const response = await scriptRequest.promise;
      await healthyPageStarted.promise;
      const liveHealth = await fetch(`${connection.url}/health`); assert.equal(liveHealth.status, 200);
      response.setHeader('Content-Type', 'application/javascript'); response.end(startupScript);
      await slowPageStarted.promise;
      await composition.dispose();
    } else {
      gate.resolve();
      await restoration;
      assert.equal((await reportedError.promise).message, await scriptError.promise);
      await composition.dispose();
    }
    assert.equal(workerAttempts, 0);
    assert.deepEqual(browser.getPreloadScripts().map(({ id }) => id), preloads);
    assert.equal(browser.serviceWorkers.listenerCount('registration-completed'), registrations);
    assert.equal(browser.serviceWorkers.listenerCount('console-message'), diagnostics);
    console.log(`EXTENSION_STARTUP_${phase.toUpperCase()}_OK`);
  } finally {
    gate.resolve(); await composition.dispose(); console.error = nativeError;
    app.off('web-contents-created', observePage);
    browser.serviceWorkers.off('console-message', observeError);
    pageServer?.closeAllConnections(); pageServer?.close();
  }
}

main().then(() => app.exit(0), error => { console.error(`Extension startup phase: ${phase}`, error); app.exit(1); });
