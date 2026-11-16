import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { defaultDesktopNetworkProxyRouting, detectWorkspacePreviewVideoMimeType, type DocumentPreviewReadResult } from '@setsuna-desktop/contracts';
import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import { reviewMainFeature } from '@setsuna-desktop/feature-review/main';
import {
  reviewCommitMessageCapability, reviewFilePreviewCapability, reviewRendererSenderCapability,
  type DesktopReviewFileVersionInput,
} from '@setsuna-desktop/feature-review/contracts';
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
  const unusedReviewCapability = () => { throw new Error('Unused in document preview tests.'); };
  const review = await defineMainFeatureHost({ required: [reviewMainFeature], optional: [] }).activate({
    hostCapabilities: [
      provideHostCapability(reviewCommitMessageCapability, { generate: unusedReviewCapability }),
      provideHostCapability(reviewFilePreviewCapability, {
        createWorkspacePreview: unusedReviewCapability, registerContentPreview: unusedReviewCapability,
        registerHtmlPreview: unusedReviewCapability, release: unusedReviewCapability,
      }),
      provideHostCapability(reviewRendererSenderCapability, { isAllowed: (id: number) => id === window.webContents.id }),
    ],
  });
  const remoteRequests: string[] = [];
  registerMainWindowNavigationGuards(window, async () => undefined);
  const frameNavigations: Array<{ url: string; blocked: boolean; initiator?: string }> = [];
  window.webContents.on('will-frame-navigate', (event) => {
    frameNavigations.push({ url: event.url, blocked: event.defaultPrevented, initiator: event.initiator?.url });
  });
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
  await waitForPdfDocuments(window, 1, frameNavigations);
  const pdfReleased = await window.webContents.executeJavaScript('window.closePdfPreview()');
  const reviewPdfSources = await checkReviewPdfVersions(window, frameNavigations);
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
  console.log(JSON.stringify({ ...result, remoteRequests, pdfLoaded: true, pdfReleased, reviewPdfSources, video: { ...video, released, ranges } }));
  window.destroy();
  await review.dispose();
  await bridge.stop();
  app.exit(0);
}

async function checkReviewPdfVersions(window: BrowserWindow, frameNavigations: unknown[]) {
  const workspace = path.join(root, 'review');
  const revisions = JSON.parse(await readFile(path.join(root, 'review-revisions.json'), 'utf8')) as DesktopReviewFileVersionInput['revisions'];
  const checked: string[] = [];
  for (const [source, expectedVersions] of [
    ['staged', ['committed', 'index']],
    ['unstaged', ['index', 'worktree']],
    ['commit', ['base', 'committed']],
  ] as const) {
    const documents: number[][] = [];
    for (const [index, side] of (['before', 'after'] as const).entries()) {
      const input: DesktopReviewFileVersionInput = {
        filePath: 'sample.pdf', source, side, ...(source === 'commit' ? { revisions } : {}),
      };
      const result = await window.webContents.executeJavaScript(
        `window.setsunaDesktop.desktopReview.readDocumentFile(${JSON.stringify(workspace)}, ${JSON.stringify(input)})`,
      ) as DocumentPreviewReadResult;
      if (!result.ok) throw new Error(`${source}/${side}: ${result.error}`);
      if (!Buffer.from(result.data).toString('utf8').endsWith(`% version: ${expectedVersions[index]}\n`)) {
        throw new Error(`${source}/${side} loaded the wrong PDF version.`);
      }
      documents.push(Array.from(result.data));
    }
    // Review mounts both sides together; each reader must finish loading its own document.
    await window.webContents.executeJavaScript(`window.openPdfPreview(${JSON.stringify(documents)})`);
    await waitForPdfDocuments(window, 2, frameNavigations);
    if (!await window.webContents.executeJavaScript('window.closePdfPreview()')) {
      throw new Error(`${source} PDF previews were not released.`);
    }
    checked.push(source);
  }
  return checked;
}

async function waitForPdfDocuments(window: BrowserWindow, count: number, frameNavigations: unknown[]) {
  let states: Array<{ pages: number; progress: number }> = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const frames = window.webContents.mainFrame.framesInSubtree.filter((frame) => frame.url.startsWith('chrome-extension://'));
    // The reader shell can mount even when its PDF plugin never receives a document.
    states = await Promise.all(frames.map((frame) => frame.executeJavaScript('(() => { const viewer = document.querySelector("pdf-viewer"); return { pages: viewer?.docLength_ ?? 0, progress: viewer?.loadProgress_ ?? 0 }; })()'))) as typeof states;
    if (states.filter((state) => state.pages > 0 && state.progress === 100).length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Native PDF documents did not load: ${JSON.stringify({ states, frameNavigations })}`);
}

void main().catch((error: unknown) => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Office preview timed out.'); app.exit(2); }, 45_000).unref();
