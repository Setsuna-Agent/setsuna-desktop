import { ipcRenderer } from 'electron';
import { executeInExtensionWorld } from './extension-world.js';
import { EXTENSION_TABS_CHANNELS as channels, type ExtensionApiResult, type ExtensionTabEvent, type ExtensionTabReadDetails, type ExtensionTabReadQuery } from '../contracts/extension-api.js';

export function initializeExtensionTabs(): void {
  // Main authenticates both extension frames and MV3 workers. Websites cannot acquire this bridge.
  if (!ipcRenderer.sendSync(channels.bootstrap)) return;
  executeInExtensionWorld(installExtensionTabs, [{
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
    onEvent: (listener: (value: ExtensionTabEvent) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
  }]);
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
      // Keep native argument validation and fields the host does not own (audio, IDs).
      const requested = native.apply(tabs, args);
      const query = method === 'query' ? args[0] as ExtensionTabReadQuery : undefined;
      const filters = query ? { title: query.title, url: Array.isArray(query.url) ? [...query.url] : query.url,
        active: query.active, highlighted: query.highlighted, currentWindow: query.currentWindow,
        lastFocusedWindow: query.lastFocusedWindow, windowId: query.windowId } : undefined;
      const withoutPrivateFilters = filters && (filters.title !== undefined || filters.url !== undefined)
        ? { ...query, title: undefined, url: undefined } : null;
      const candidatesQuery = filters && (filters.active !== undefined || filters.highlighted !== undefined
        || filters.currentWindow || filters.lastFocusedWindow || filters.windowId !== undefined)
        ? { ...query, title: undefined, url: undefined, active: undefined, highlighted: undefined,
          currentWindow: undefined, lastFocusedWindow: undefined, windowId: undefined } : null;
      const result = Promise.resolve(requested).then(async value => {
        type NativeTab = Record<string, unknown> & { id: number };
        // URL/title access follows host grants for both documents and guests.
        // Keep native window/focus matches before broadening the guest candidates.
        if (withoutPrivateFilters) value = await native.call(tabs, withoutPrivateFilters);
        const nativeMatches = candidatesQuery ? new Map((value as NativeTab[]).map(tab => [tab.id, tab])) : null;
        if (candidatesQuery) value = await native.call(tabs, candidatesQuery);
        const nativeTabs = (method === 'query' ? value : [value]) as NativeTab[];
        const details = await call('read', [nativeTabs.map(tab => tab.id), filters]) as ExtensionTabReadDetails[];
        const allowed = new Map(details.map(tab => [tab.id, tab]));
        const result: NativeTab[] = [];
        for (const tab of nativeTabs) {
          const detail = allowed.get(tab.id);
          if (!detail) continue;
          // Host state is present only for managed webviews. Other documents keep
          // the native window/focus matches and the fields from that snapshot.
          const source = detail.active !== undefined || !nativeMatches ? tab : nativeMatches.get(tab.id);
          if (!source) continue;
          const { url: _url, title: _title, pendingUrl: _pendingUrl, favIconUrl: _icon, ...fields } = source;
          result.push({ ...fields, ...detail });
        }
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
