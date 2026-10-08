import { contextBridge, ipcRenderer } from 'electron';
import { EXTENSION_SYSTEM_CHANNELS as channels, type ExtensionApiResult, type ExtensionSystemBootstrap, type ExtensionSystemEvent } from '../contracts/extension-api.js';
import { installNativeMessaging } from './native-messaging.js';
import { installExtensionScripting } from './extension-scripting.js';

export function initializeExtensionSystem(): void {
  const bootstrap = ipcRenderer.sendSync(channels.bootstrap) as ExtensionSystemBootstrap | null;
  if (!bootstrap) return;
  const transport = {
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
    onEvent: (listener: (event: ExtensionSystemEvent) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
  };
  contextBridge.executeInMainWorld({ func: installExtensionSystem, args: [bootstrap, transport] });
  if (bootstrap.nativeMessaging) contextBridge.executeInMainWorld({ func: installNativeMessaging, args: [transport] });
  if (bootstrap.scripting) contextBridge.executeInMainWorld({ func: installExtensionScripting, args: [transport] });
}

export function installExtensionSystem(bootstrap: ExtensionSystemBootstrap, transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
  onEvent(listener: (event: ExtensionSystemEvent) => void): void;
}): void {
  type Listener = (...args: unknown[]) => void;
  const scope = globalThis as unknown as { chrome?: { debugger?: Record<string, unknown>; commands?: Record<string, unknown>;
    contextMenus?: Record<string, unknown>; downloads?: Record<string, unknown>; webNavigation?: Record<string, unknown>;
    cookies?: Record<string, unknown>; bookmarks?: Record<string, unknown>; permissions?: Record<string, unknown>;
    storage?: { managed?: Record<string, unknown> };
    runtime?: { lastError?: { message: string }; onStartup?: unknown; id?: string; getURL?: (path: string) => string } } };
  const chrome = scope.chrome;
  const runtime = chrome?.runtime;
  if (!chrome || !runtime) return;
  const call = (method: string, args: unknown[]) => {
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
      finally { if (previous) Object.defineProperty(runtime, 'lastError', previous); else delete runtime.lastError; }
    });
    return undefined;
  };
  const events = new Map<ExtensionSystemEvent['kind'], Set<Listener>>();
  const eventObject = (kind: ExtensionSystemEvent['kind']) => {
    const listeners = new Set<Listener>(); events.set(kind, listeners);
    return {
      addListener(listener: Listener) { if (typeof listener !== 'function') throw new TypeError('Expected a listener.'); listeners.add(listener); },
      removeListener: (listener: Listener) => listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener), hasListeners: () => listeners.size > 0,
    };
  };
  // Electron exposes this event but treats restored installations as fresh loads.
  // The host emits it once after the restored worker has registered its listeners.
  runtime.onStartup = eventObject('startup');
  if (bootstrap.faviconUrl && runtime.getURL) {
    const nativeGetUrl = runtime.getURL.bind(runtime);
    runtime.getURL = (path: string) => {
      const original = nativeGetUrl(path);
      const url = new URL(original);
      return url.hostname === runtime.id && url.pathname === '/_favicon/'
        ? `${bootstrap.faviconUrl}${url.search}${url.hash}` : original;
    };
  }
  if (bootstrap.debugger && !chrome.debugger) {
    chrome.debugger = { onEvent: eventObject('debuggerEvent'), onDetach: eventObject('debuggerDetach') };
    for (const method of ['attach', 'detach', 'sendCommand', 'getTargets']) chrome.debugger[method] = (...args: unknown[]) => call(`debugger.${method}`, args);
  }
  if (!chrome.commands) chrome.commands = { getAll: (...args: unknown[]) => call('commands.getAll', args), onCommand: eventObject('command') };
  if (bootstrap.contextMenus && !chrome.contextMenus) {
    let sequence = 0;
    chrome.contextMenus = { onClicked: eventObject('contextMenuClicked'), create: (properties: unknown, callback?: Listener) => {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new TypeError('Expected menu properties.');
      const input = properties as Record<string, unknown>;
      const id = input.id ?? ++sequence;
      const result = call('contextMenus.create', [{ ...input, id }, ...(callback ? [callback] : [])]);
      if (result) void result.catch(console.error);
      return id;
    } };
    for (const method of ['update', 'remove', 'removeAll']) chrome.contextMenus[method] = (...args: unknown[]) => call(`contextMenus.${method}`, args);
  }
  if (bootstrap.downloads && !chrome.downloads) {
    chrome.downloads = { onCreated: eventObject('downloadCreated'), onChanged: eventObject('downloadChanged') };
    for (const method of ['search', 'show']) chrome.downloads[method] = (...args: unknown[]) => call(`downloads.${method}`, args);
  }
  if (bootstrap.webNavigation && !chrome.webNavigation) chrome.webNavigation = {
    getAllFrames: (...args: unknown[]) => call('webNavigation.getAllFrames', args),
    onCreatedNavigationTarget: eventObject('navigationTargetCreated'),
  };
  if (!chrome.permissions) {
    chrome.permissions = { onAdded: eventObject('permissionsAdded'), onRemoved: eventObject('permissionsRemoved') };
    for (const method of ['getAll', 'contains', 'request', 'remove']) chrome.permissions[method] = (...args: unknown[]) => call(`permissions.${method}`, args);
  }
  if (bootstrap.cookies && !chrome.cookies) {
    chrome.cookies = { onChanged: eventObject('cookieChanged') };
    for (const method of ['get', 'getAll', 'getAllCookieStores', 'set', 'remove']) chrome.cookies[method] = (...args: unknown[]) => call(`cookies.${method}`, args);
  }
  if (bootstrap.bookmarks && !chrome.bookmarks) {
    chrome.bookmarks = {};
    for (const method of ['get', 'getTree', 'getSubTree', 'getChildren', 'search', 'update', 'remove', 'removeTree']) chrome.bookmarks[method] = (...args: unknown[]) => call(`bookmarks.${method}`, args);
  }
  if (bootstrap.storage && chrome.storage) {
    // Electron creates this namespace but every native read fails. With no enterprise
    // policy backend the managed area has no values and all writes remain forbidden.
    const managed: Record<string, unknown> = {};
    for (const method of ['get', 'getKeys', 'getBytesInUse', 'set', 'remove', 'clear']) managed[method] = (...args: unknown[]) => call(`storage.managed.${method}`, args);
    chrome.storage.managed = managed;
  }
  transport.onEvent((event) => {
    if (event.kind === 'nativeMessage' || event.kind === 'nativeDisconnect') return;
    const args = event.kind === 'startup' ? []
      : event.kind === 'debuggerEvent' ? [event.source, event.method, event.params]
      : event.kind === 'debuggerDetach' ? [event.source, event.reason]
      : event.kind === 'command' ? [event.command, event.tab]
      : event.kind === 'contextMenuClicked' ? [event.info, event.tab]
      : event.kind === 'downloadCreated' ? [event.item]
      : event.kind === 'downloadChanged' ? [event.delta]
      : event.kind === 'cookieChanged' ? [event.changeInfo]
      : event.kind === 'permissionsAdded' || event.kind === 'permissionsRemoved' ? [event.permissions] : [event.details];
    for (const listener of [...(events.get(event.kind) ?? [])]) {
      try { listener(...args); } catch (error) { console.error(error); }
    }
  });
}
