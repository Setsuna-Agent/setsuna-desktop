import { app, BrowserWindow, dialog } from 'electron';
import assert from 'node:assert/strict';
import { defaultDesktopNetworkProxyRouting, type RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { DesktopNativeBridgeServer } from '../../src/runtime/native-bridge-server.js';
import { showSandboxDialog } from '../../src/window/sandbox-dialogs.js';

const { createSandboxedUiDocument } = require(process.argv[3]) as {
  createSandboxedUiDocument(source: RuntimeSandboxedUiSource, options: { size: 'fill'; dialogUrl: string }): string;
};

app.setPath('userData', process.argv[2]);
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const confirmationAnswers = [1, 0, 0];
  dialog.showMessageBox = (async () => ({ response: confirmationAnswers.shift() ?? 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  const promptAnswers: Array<string | null | { close: 'escape' | 'window' }> = ['New  name ', null, '', { close: 'escape' }, { close: 'window' }];
  const defaults: string[] = [];
  app.on('browser-window-created', (_event, window) => {
    // Functional verification stays entirely hidden; no style inspection or user dialogs.
    window.show = () => undefined;
    window.focus = () => undefined;
    if (!window.getParentWindow()) return;
    const answer = promptAnswers.shift();
    window.webContents.once('did-finish-load', () => {
      void window.webContents.executeJavaScript("document.querySelector('input').value").then((value: string) => {
        defaults.push(value);
        if (answer && typeof answer === 'object') {
          if (answer.close === 'window') { window.close(); return; }
          return window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))");
        }
        return window.webContents.executeJavaScript(answer === null
          ? "document.querySelector('button[type=button]').click()"
          : `document.querySelector('input').value = ${JSON.stringify(answer)}; document.querySelector('form').requestSubmit();`);
      }).catch((error: unknown) => { if (!window.isDestroyed()) throw error; });
    });
  });
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  const server = new DesktopNativeBridgeServer({
    credentialVault: { status: async () => ({ available: true, backend: 'test' }), get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    deleteThread: async () => ({ cancelled: true }), writeClipboardText: () => undefined,
    deleteNetworkProxy: async () => ({ configPath: '', routing: defaultDesktopNetworkProxyRouting(), servers: [] }),
    openExternal: async () => undefined, resolveNetworkProxy: async () => ({ mode: 'direct' }),
    resolveSandboxNetworkEnvironment: async () => ({}), systemProxyFetch: async () => new Response(),
    validateNetworkProxyReferences: async () => undefined,
    showSandboxDialog: (window, input, options) => showSandboxDialog(window, input, { ...options, language: 'en-US' }),
  });
  try {
    const connection = await server.start();
    const session = server.registerSandboxDialogSession(owner, 'Table');
    await owner.loadURL('data:text/html,<html><body></body></html>');
    const source = createSandboxedUiDocument({ html: '<main>Table</main>', css: '', js: `
      let mutations = 0;
      if (confirm('Cancel deletion')) mutations++;
      if (window.confirm('Confirm deletion')) mutations++;
      const name = prompt('Rename', 'Old  name ');
      const cancelled = window.prompt('Cancel rename', '</script><script>window.injected=true</script>');
      const empty = prompt('Empty value', 'Old');
      const escaped = prompt('Dismiss with Escape');
      const closed = prompt('Dismiss with window close');
      const alertReturnedVoid = alert('Done') === undefined;
      let isolated = false;
      try { parent.document.body; } catch { isolated = true; }
      let networkBlocked = false;
      try { const request = new XMLHttpRequest(); request.open('GET', ${JSON.stringify(`${connection.url}/health`)}, false); request.send(); }
      catch { networkBlocked = true; }
      parent.postMessage({type:'test-result', mutations, name, cancelled, empty, escaped, closed, alertReturnedVoid, isolated, networkBlocked, node: typeof process}, '*');
    ` }, { size: 'fill', dialogUrl: session.url });
    const result = await owner.webContents.executeJavaScript(`new Promise(resolve => {
      window.addEventListener('message', event => { if (event.data?.type === 'test-result') resolve(event.data); });
      const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts';
      frame.srcdoc = ${JSON.stringify(source)}; document.body.append(frame);
    })`);
    assert.deepEqual(result, {
      type: 'test-result', mutations: 1, name: 'New  name ', cancelled: null, empty: '', escaped: null, closed: null,
      alertReturnedVoid: true, isolated: true, networkBlocked: true, node: 'undefined',
    });
    assert.deepEqual(defaults, ['Old  name ', '</script><script>window.injected=true</script>', 'Old', '', '']);
    assert.equal(confirmationAnswers.length, 0);
    const unauthorized = await fetch(`${connection.url}/v1/credentials/status`, { headers: { Authorization: `Bearer ${session.id}` } });
    assert.equal(unauthorized.status, 401);
    server.releaseSandboxDialogSession(owner.webContents.id, session.id);
    const revoked = await fetch(session.url, { method: 'POST', body: JSON.stringify({ kind: 'confirm', message: 'no' }) });
    assert.equal(revoked.status, 400);
    process.stdout.write('SANDBOX_DIALOGS_PASSED\n');
  } finally {
    owner.destroy();
    await server.stop();
  }
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
