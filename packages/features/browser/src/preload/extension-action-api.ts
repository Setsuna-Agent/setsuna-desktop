import type { ExtensionApiResult } from '../contracts/extension-api.js';

/** Native MV3 action calls remain authoritative; MV2 actions use the host's toolbar state. */
export function installExtensionActionApi(legacy: boolean, send: (update: unknown) => Promise<unknown>,
  call: (method: string, args: unknown[]) => Promise<ExtensionApiResult>): void {
  type Method = (...args: unknown[]) => unknown;
  const scope = globalThis as unknown as {
    location?: { protocol: string };
    chrome?: { action?: Record<string, Method>; browserAction?: Record<string, Method>; runtime?: { lastError?: unknown } };
  };
  const chrome = scope.chrome;
  if (scope.location?.protocol !== 'chrome-extension:' || !chrome?.runtime) return;
  const action = chrome.action;
  if (!action) {
    if (!legacy || chrome.browserAction) return;
    const runtime = chrome.runtime;
    const browserAction: Record<string, Method> = chrome.browserAction = {};
    for (const method of ['setIcon', 'setPopup', 'getPopup', 'setTitle', 'getTitle',
      'setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor']) {
      browserAction[method] = (details: unknown, callback: unknown) => {
        if (!details || typeof details !== 'object' || Array.isArray(details)) throw new TypeError('Expected action details.');
        if (callback !== undefined && typeof callback !== 'function') throw new TypeError('Expected a callback.');
        const snapshot = method === 'setIcon' ? serialize(method, details) : Promise.resolve({ ...details, method });
        const result = snapshot.then(update => call(`browserAction.${method}`, [update])).then(reply => {
          if (!reply.ok) throw new Error(reply.error);
          return reply.result;
        });
        if (typeof callback !== 'function') return result;
        void result.then(value => callback(value), (error: Error) => {
          const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
          Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message: error.message } });
          try { callback(); }
          finally { if (previous) Object.defineProperty(runtime, 'lastError', previous); else delete runtime.lastError; }
        });
        return undefined;
      };
    }
    return;
  }

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
