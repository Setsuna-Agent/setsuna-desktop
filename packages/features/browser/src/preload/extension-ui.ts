import { contextBridge, ipcRenderer } from 'electron';
import { EXTENSION_UI_CHANNELS as channels, type ExtensionApiResult, type ExtensionUiEvent } from '../contracts/extension-api.js';

export function initializeExtensionUi(): void {
  const bootstrap = ipcRenderer.sendSync(channels.bootstrap) as { sidePanel: boolean } | null;
  if (!bootstrap) return;
  contextBridge.executeInMainWorld({ func: installExtensionUi, args: [bootstrap, {
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
    onEvent: (listener: (event: ExtensionUiEvent) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
  }] });
}

function installExtensionUi(bootstrap: { sidePanel: boolean }, transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
  onEvent(listener: (event: ExtensionUiEvent) => void): void;
}): void {
  type Listener = (...args: unknown[]) => void;
  const scope = globalThis as unknown as { chrome?: { action?: Record<string, unknown>; windows?: Record<string, unknown>;
    sidePanel?: Record<string, unknown>; runtime?: { lastError?: { message: string } } } };
  const chrome = scope.chrome;
  const runtime = chrome?.runtime;
  if (!chrome || !runtime) return;

  const call = (method: string, args: unknown[]) => {
    const callback = typeof args.at(-1) === 'function' ? args.pop() as Listener : undefined;
    const promise = transport.call(method, args).then((reply) => {
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    });
    if (!callback) return promise;
    void promise.then((value) => callback(value), (error: Error) => {
      const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
      Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message: error.message } });
      try { callback(); }
      finally { if (previous) Object.defineProperty(runtime, 'lastError', previous); else delete runtime.lastError; }
    });
    return undefined;
  };
  const events = new Map<ExtensionUiEvent['kind'], Set<Listener>>();
  const dispatch = (event: ExtensionUiEvent) => {
    const args = event.kind === 'actionClicked' ? [event.tab] : event.kind === 'windowFocusChanged' ? [event.windowId]
      : [{ windowId: event.windowId, path: event.path, ...(event.tabId === undefined ? {} : { tabId: event.tabId }) }];
    for (const listener of [...(events.get(event.kind) ?? [])]) {
      try { listener(...args); } catch (error) { console.error(error); }
    }
  };
  const eventObject = (kind: ExtensionUiEvent['kind'], changed?: (listening: boolean) => void) => {
    const listeners = new Set<Listener>(); events.set(kind, listeners);
    return {
      addListener(listener: Listener) {
        if (typeof listener !== 'function') throw new TypeError('Expected a listener.');
        const alreadyListening = listeners.size > 0;
        listeners.add(listener); if (!alreadyListening) changed?.(true);
      },
      removeListener(listener: Listener) { if (listeners.delete(listener) && !listeners.size) changed?.(false); },
      hasListener: (listener: Listener) => listeners.has(listener), hasListeners: () => listeners.size > 0,
    };
  };
  if (chrome.action) {
    // Chromium has no toolbar for the desktop's webview tabs, so the host delivers its
    // clicks to the same listeners registered by the extension's background worker.
    chrome.action.onClicked = eventObject('actionClicked', (listening) => {
      void transport.call('actionListen', [listening]).catch(() => undefined);
    });
  }
  const windows = chrome.windows ?? (chrome.windows = {});
  for (const method of ['get', 'getCurrent', 'getLastFocused', 'getAll']) {
    if (typeof windows[method] !== 'function') windows[method] = (...args: unknown[]) => call(`windows.${method}`, args);
  }
  windows.WINDOW_ID_NONE ??= -1; windows.WINDOW_ID_CURRENT ??= -2;
  windows.onFocusChanged ??= eventObject('windowFocusChanged');
  if (bootstrap.sidePanel) {
    const sidePanel = chrome.sidePanel ?? (chrome.sidePanel = {});
    for (const method of ['getOptions', 'setOptions', 'getPanelBehavior', 'setPanelBehavior', 'getLayout', 'open', 'close']) {
      if (typeof sidePanel[method] !== 'function') sidePanel[method] = (...args: unknown[]) => call(method, args);
    }
    for (const [name, kind] of [['onOpened', 'panelOpened'], ['onClosed', 'panelClosed']] as const) {
      sidePanel[name] ??= eventObject(kind, (listening) => {
        void transport.call('panelListen', [kind, listening]).then((reply) => {
          if (reply.ok && Array.isArray(reply.result)) for (const event of reply.result) dispatch(event as ExtensionUiEvent);
        }).catch(() => undefined);
      });
    }
  }
  transport.onEvent((event) => {
    dispatch(event);
  });
}
