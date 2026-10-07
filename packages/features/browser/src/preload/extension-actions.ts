import { contextBridge, ipcRenderer } from 'electron';
import { initializeUserScripts } from './user-scripts.js';
import { initializeExtensionTabs } from './extension-tabs.js';
import { initializeExtensionUi } from './extension-ui.js';
import { initializeExtensionSystem } from './extension-system.js';
import { BROWSER_EXTENSION_ACTION_CHANNEL } from '../contracts/extensions.js';

/** Runs before extension scripts, including MV3 workers. Ordinary websites get no bridge. */
contextBridge.executeInMainWorld({
  func: installActionObserver,
  args: [(update: unknown) => ipcRenderer.invoke(BROWSER_EXTENSION_ACTION_CHANNEL, update)],
});

function installActionObserver(send: (update: unknown) => Promise<unknown>): void {
  type Method = (...args: unknown[]) => unknown;
  const scope = globalThis as unknown as {
    location?: { protocol: string };
    chrome?: { action?: Record<string, Method>; runtime?: { lastError?: unknown } };
  };
  const action = scope.chrome?.action;
  if (scope.location?.protocol !== 'chrome-extension:' || !action) return;

  // Keep Chromium's validation, permissions, callback errors and Promise behavior intact.
  for (const method of ['setIcon', 'setPopup', 'setTitle']) {
    const native = action[method];
    if (typeof native !== 'function') continue;
    action[method] = (details: unknown, callback: unknown) => {
      const snapshot = serialize(method, details).catch(() => null);
      const publish = () => snapshot.then((update) => update && send(update)).catch(() => undefined);
      if (typeof callback === 'function') {
        return native.call(action, details, (...args: unknown[]) => {
          if (!scope.chrome?.runtime?.lastError) void publish();
          callback(...args);
        });
      }
      const result = native.call(action, details);
      return Promise.resolve(result).then(async (value) => { await publish(); return value; });
    };
  }

  async function serialize(method: string, raw: unknown): Promise<unknown> {
    const details = raw as Record<string, unknown>;
    const update: Record<string, unknown> = { method, tabId: details?.tabId };
    if (method === 'setPopup') return { ...update, popup: details?.popup };
    if (method === 'setTitle') return { ...update, title: details?.title };
    if (details?.path) return { ...update, path: typeof details.path === 'object' ? { ...details.path } : details.path };
    const source = details?.imageData as ImageData | Record<string, ImageData> | undefined;
    const image = source && ('width' in source ? source as ImageData : Object.entries(source)
      .sort(([a], [b]) => Math.abs(Number(a) - 32) - Math.abs(Number(b) - 32))[0]?.[1]);
    if (!image || image.width < 1 || image.height < 1 || image.width > 256 || image.height > 256) return update;
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { ...update, dataUrl: `data:image/png;base64,${btoa(binary)}` };
  }
}
initializeExtensionTabs();
initializeExtensionUi();
initializeExtensionSystem();
initializeUserScripts();
