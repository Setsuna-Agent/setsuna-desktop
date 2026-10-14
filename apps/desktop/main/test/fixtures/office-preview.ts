import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { defaultDesktopNetworkProxyRouting, detectWorkspacePreviewVideoMimeType } from '@setsuna-desktop/contracts';
import { registerMainWindowNavigationGuards } from '../../src/window/navigation.js';
import { DesktopNativeBridgeServer } from '../../src/runtime/native-bridge-server.js';
import { registerDesktopIpc } from '../../src/ipc/desktop-ipc.js';
import { desktopWindows } from '../../src/window/registry.js';

const root = process.argv[2];
app.setPath('userData', path.join(root, 'user-data'));
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');

async function main() {
  await app.whenReady();
  const bridge = new DesktopNativeBridgeServer({
    credentialVault: { status: async () => ({ available: true, backend: 'test' }),
      get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    deleteThread: async () => ({ cancelled: true }), writeClipboardText: () => undefined,
    deleteNetworkProxy: async () => ({ configPath: '', routing: defaultDesktopNetworkProxyRouting(), servers: [] }),
    openExternal: async () => undefined, resolveNetworkProxy: async () => ({ mode: 'direct' }),
    resolveSandboxNetworkEnvironment: async () => ({}), systemProxyFetch: async () => new Response(''),
    validateNetworkProxyReferences: async () => undefined,
  });
  const connection = await bridge.start();
  registerDesktopIpc({
    nativeBridge: bridge, readAttachmentImage: async () => { throw new Error('Unused in preview tests.'); },
    onActiveKeyboardShortcutBindingsChange: () => undefined, onInterfaceLanguageChange: () => undefined,
    interfaceLanguage: () => 'en-US', userDataPath: path.join(root, 'user-data'),
  });
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    preload: path.join(root, 'preload.cjs'),
  } });
  desktopWindows.add(window);
  const remoteRequests: string[] = [];
  registerMainWindowNavigationGuards(window, async () => undefined);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.url.startsWith(`${connection.url}/v1/file-previews/`)) { callback({}); return; }
    remoteRequests.push(details.url);
    callback({ cancel: true });
  });
  const ranges: string[] = [];
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`${connection.url}/*`] }, (details, callback) => {
    const range = Object.entries(details.requestHeaders).find(([key]) => key.toLowerCase() === 'range')?.[1];
    if (range) ranges.push(range);
    callback({ requestHeaders: details.requestHeaders });
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(event.message);
  });
  await window.loadFile(path.join(root, 'renderer/office-preview.html'));
  await window.webContents.executeJavaScript('window.openPdfPreview()');
  let pdfLoaded = false;
  for (let attempt = 0; attempt < 100 && !pdfLoaded; attempt += 1) {
    for (const frame of window.webContents.mainFrame.framesInSubtree) {
      if (!frame.url.startsWith('chrome-extension://')) continue;
      pdfLoaded = await frame.executeJavaScript('Boolean(document.querySelector("pdf-viewer")?.shadowRoot?.querySelector("embed"))') === true;
      if (pdfLoaded) break;
    }
    if (!pdfLoaded) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!pdfLoaded) throw new Error(`Native PDF viewer did not load: ${JSON.stringify(window.webContents.mainFrame.framesInSubtree.map((frame) => frame.url))}`);
  const pdfReleased = await window.webContents.executeJavaScript('window.closePdfPreview()');
  const result = await window.webContents.executeJavaScript('window.checkOfficePreviews()');
  const workspaceRoot = path.join(root, 'media');
  const sample = await readFile(path.join(workspaceRoot, 'sample.mp4'));
  const mimeType = detectWorkspacePreviewVideoMimeType('sample.mp4', sample);
  if (!mimeType) throw new Error('MP4 was not classified as a video preview.');
  const file = { projectId: 'test', path: 'sample.mp4', size: sample.length, content: '', truncated: false, preview: { kind: 'video', mimeType } };
  const video = await window.webContents.executeJavaScript(`window.checkVideoPreview(${JSON.stringify(workspaceRoot)}, ${JSON.stringify(file)})`, true);
  let released = false;
  for (let attempt = 0; attempt < 100 && !released; attempt += 1) {
    released = (await fetch(video.url, { method: 'HEAD' })).status === 404;
    if (!released) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  console.log(JSON.stringify({ ...result, remoteRequests, pdfLoaded, pdfReleased, video: { ...video, released, ranges } }));
  window.destroy();
  await bridge.stop();
  app.exit(0);
}

void main().catch((error: unknown) => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Office preview timed out.'); app.exit(2); }, 45_000).unref();
