import { contextBridge, ipcRenderer } from 'electron';
import { EXTENSION_TABS_CHANNELS as channels, type ExtensionApiResult, type ExtensionTabEvent, type ExtensionTabReadDetails, type ExtensionTabReadQuery } from '../contracts/extension-api.js';

export function initializeExtensionTabs(): void {
  // Main authenticates both extension frames and MV3 workers. Websites cannot acquire this bridge.
  if (!ipcRenderer.sendSync(channels.bootstrap)) return;
  contextBridge.executeInMainWorld({ func: installExtensionTabs, args: [{
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
    onEvent: (listener: (value: ExtensionTabEvent) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
  }] });
}

export function installExtensionTabs(transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
  onEvent(listener: (value: ExtensionTabEvent) => void): void;
}): void {
  type Listener = (...args: unknown[]) => void;
  const scope = globalThis as unknown as { chrome?: { tabs?: Record<string, unknown>; runtime?: { lastError?: { message: string } } } };
  const tabs = scope.chrome?.tabs;
  const runtime = scope.chrome?.runtime;
  if (!tabs || !runtime) return;
  const call = (method: string, args: unknown[]) => transport.call(method, args).then(reply => {
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  });
  const complete = (result: Promise<unknown>, callback?: Listener) => {
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
  for (const method of ['get', 'query']) {
    const native = tabs[method] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof native !== 'function') continue;
    tabs[method] = (...args: unknown[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() as Listener : undefined;
      // Keep native argument validation and non-sensitive fields (focus, audio, IDs).
      const requested = native.apply(tabs, args);
      const query = method === 'query' ? args[0] as ExtensionTabReadQuery : undefined;
      const filters = query ? { title: query.title, url: Array.isArray(query.url) ? [...query.url] : query.url } : undefined;
      const unfiltered = filters && (filters.title || filters.url !== undefined)
        ? { ...query, title: undefined, url: undefined } : null;
      const result = Promise.resolve(requested).then(async value => {
        // Chromium cannot see host-managed optional grants. After native validation,
        // query candidates without its stale URL/title gate, then filter them in main.
        if (unfiltered) value = await native.call(tabs, unfiltered);
        const nativeTabs = (method === 'query' ? value : [value]) as Array<Record<string, unknown> & { id: number }>;
        const details = await call('read', [nativeTabs.map(tab => tab.id), filters]) as ExtensionTabReadDetails[];
        const allowed = new Map(details.map(tab => [tab.id, tab]));
        const result = nativeTabs.filter(tab => allowed.has(tab.id)).map(tab => {
          const { url: _url, title: _title, pendingUrl: _pendingUrl, favIconUrl: _icon, ...fields } = tab;
          return { ...fields, ...allowed.get(tab.id) };
        });
        return method === 'query' ? result : result[0];
      });
      return complete(result, callback);
    };
  }
  for (const method of ['create', 'remove']) {
    if (typeof tabs[method] === 'function') continue;
    tabs[method] = (...args: unknown[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() as Listener : undefined;
      return complete(call(method, args), callback);
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
