import { contextBridge, ipcRenderer } from 'electron';
import { EXTENSION_TABS_CHANNELS as channels, type ExtensionApiResult, type ExtensionTabEvent } from '../contracts/extension-api.js';

export function initializeExtensionTabs(): void {
  // Main authenticates both extension frames and MV3 workers. Websites cannot acquire this bridge.
  if (!ipcRenderer.sendSync(channels.bootstrap)) return;
  contextBridge.executeInMainWorld({ func: installExtensionTabs, args: [{
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
    onEvent: (listener: (value: ExtensionTabEvent) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
  }] });
}

function installExtensionTabs(transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
  onEvent(listener: (value: ExtensionTabEvent) => void): void;
}): void {
  type Listener = (...args: unknown[]) => void;
  const scope = globalThis as unknown as { chrome?: { tabs?: Record<string, unknown>; runtime?: { lastError?: { message: string } } } };
  const tabs = scope.chrome?.tabs;
  const runtime = scope.chrome?.runtime;
  if (!tabs || !runtime) return;
  for (const method of ['create', 'remove']) {
    if (typeof tabs[method] === 'function') continue;
    tabs[method] = (...args: unknown[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() as Listener : undefined;
      const result = transport.call(method, args).then((reply) => {
        if (!reply.ok) throw new Error(reply.error);
        return reply.result;
      });
      if (!callback) return result;
      void result.then((value) => callback(value), (error: Error) => {
        const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
        Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message: error.message } });
        try { callback(); }
        finally {
          if (previous) Object.defineProperty(runtime, 'lastError', previous);
          else delete runtime.lastError;
        }
      });
      return undefined;
    };
  }
  const events = { updated: new Set<Listener>(), removed: new Set<Listener>() };
  // Electron's native events omit webview guests. Use the host's owned-tab lifecycle so a
  // script installation redirect is delivered once, with the real Chromium tab ID.
  for (const [kind, name] of [['updated', 'onUpdated'], ['removed', 'onRemoved']] as const) {
    const listeners = events[kind];
    tabs[name] = {
      addListener: (listener: Listener) => { if (typeof listener !== 'function') throw new TypeError('Expected a listener.'); listeners.add(listener); },
      removeListener: (listener: Listener) => listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
    };
  }
  transport.onEvent((event) => {
    const args = event.kind === 'updated' ? [event.tabId, event.changeInfo, event.tab] : [event.tabId, event.removeInfo];
    for (const listener of [...events[event.kind]]) {
      try { listener(...args); } catch (error) { console.error(error); }
    }
  });
}
