import type { UserScriptsBootstrap, UserScriptsCallResult, UserScriptsExtensionEvent } from '../contracts/user-scripts.js';

export interface UserScriptsTransport {
  call(method: string, args: unknown[]): Promise<UserScriptsCallResult>;
  onEvent(listener: (event: UserScriptsExtensionEvent) => void): void;
}

/** Self-contained: contextBridge serializes this function into the extension's own world. */
export function installUserScriptsApi(transport: UserScriptsTransport, bootstrap: UserScriptsBootstrap): void {
  // Chrome's extension globals are supplied by Chromium, without TypeScript declarations.
  type Chrome = Record<string, any>;
  const chrome = (globalThis as typeof globalThis & { chrome: Chrome }).chrome;
  if (!chrome?.runtime) return;
  let allowed = bootstrap.allowed;

  const api: Chrome = {};
  const methods = ['register', 'getScripts', 'unregister', 'update', 'configureWorld', 'getWorldConfigurations', 'resetWorldConfiguration', 'execute'];
  const ports = new Map<string, Chrome>();
  type Listener = (...args: any[]) => unknown;
  function event() {
    const listeners = new Set<Listener>();
    return {
      addListener: (listener: Listener) => { if (typeof listener === 'function') listeners.add(listener); },
      removeListener: (listener: Listener) => listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
      dispatch: (...args: unknown[]) => [...listeners].map((listener) => {
        try { return listener(...args); } catch (error) { setTimeout(() => { throw error; }, 0); return undefined; }
      }),
    };
  }
  const messages = event();
  const connections = event();
  chrome.runtime.onUserScriptMessage = messages;
  chrome.runtime.onUserScriptConnect = connections;

  function call(method: string, args: unknown[]): Promise<unknown> {
    return transport.call(method, args).then((answer) => {
      if (!answer.ok) throw new Error(answer.error);
      return answer.result;
    });
  }
  function settle(promise: Promise<unknown>, callback?: (...args: any[]) => unknown): Promise<unknown> | undefined {
    if (!callback) return promise;
    void promise.then((result) => callback(result), (error: unknown) => {
      const previous = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');
      Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, enumerable: true,
        value: { message: error instanceof Error ? error.message : String(error) } });
      try { callback(); } finally {
        // Chromium owns lastError for its native calls. Only substitute it during our callback.
        if (previous) Object.defineProperty(chrome.runtime, 'lastError', previous);
        else Reflect.deleteProperty(chrome.runtime, 'lastError');
      }
    });
  }
  for (const method of methods) api[method] = (...args: unknown[]) => {
    if (!allowed) throw new Error("The 'userScripts' API is only available when 'Allow user scripts' is turned on for this extension.");
    const callback = typeof args.at(-1) === 'function' ? args.pop() as Listener : undefined;
    return settle(call(method, args), callback);
  };
  // Chrome 138+ exposes undefined on a denied context's startup. Revocation keeps an
  // existing namespace, but its methods throw; changing availability needs a reload.
  const namespace = bootstrap.allowed ? api : undefined;
  Object.defineProperty(chrome, 'userScripts', { configurable: true, enumerable: true, value: namespace });
  const browser = (globalThis as typeof globalThis & { browser?: Chrome }).browser;
  if (browser && browser !== chrome) Object.defineProperty(browser, 'userScripts', { configurable: true, value: namespace });

  transport.onEvent((wire) => {
    if (wire.kind === 'allowed') { allowed = wire.allowed; return; }
    if (wire.kind === 'message' && 'token' in wire) {
      let answered = false;
      const answer = (responded: boolean, result?: unknown) => {
        if (answered) return;
        answered = true; void call('messageAnswer', [{ token: wire.token, responded, result }]).catch(() => undefined);
      };
      const results = messages.dispatch(wire.message, wire.sender, (result: unknown) => answer(true, result));
      let waiting = false;
      for (const result of results) {
        if (result === true) waiting = true;
        else if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          waiting = true; Promise.resolve(result).then((value) => answer(true, value), () => answer(false));
        }
      }
      if (!waiting) answer(false);
      return;
    }
    if (wire.kind === 'connect') {
      if (!connections.hasListeners()) { void call('port', [{ kind: 'disconnect', portId: wire.portId }]); return; }
      const port: Chrome = { name: wire.name, sender: wire.sender, onMessage: event(), onDisconnect: event(),
        postMessage(message: unknown) {
          if (!ports.has(wire.portId)) throw new Error('Attempting to use a disconnected port object');
          void call('port', [{ kind: 'message', portId: wire.portId, message }]).catch(() => undefined);
        },
        disconnect() { ports.delete(wire.portId); void call('port', [{ kind: 'disconnect', portId: wire.portId }]).catch(() => undefined); },
      };
      ports.set(wire.portId, port);
      connections.dispatch(port);
      if (ports.has(wire.portId)) void call('port', [{ kind: 'accept', portId: wire.portId }]).catch(() => undefined);
      return;
    }
    if (!('portId' in wire)) return;
    const port = ports.get(wire.portId);
    if (!port) return;
    if (wire.kind === 'message') port.onMessage.dispatch(wire.message, port);
    else if (wire.kind === 'disconnect') { ports.delete(wire.portId); port.onDisconnect.dispatch(port); }
  });

  const native = chrome.tabs?.sendMessage?.bind(chrome.tabs);
  if (native) chrome.tabs.sendMessage = (...raw: unknown[]) => {
    const callback = typeof raw.at(-1) === 'function' ? raw.pop() as Listener : undefined;
    const [tabId, message, options] = raw;
    const engine = new Promise<unknown>((resolve, reject) => {
      const done = (value: unknown) => { const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); else resolve(value); };
      try { if (options === undefined) native(tabId, message, done); else native(tabId, message, options, done); }
      catch (error) { reject(error); }
    });
    const hosted = call('sendMessage', [tabId, message, options]).then((answer: any) => {
      if (answer?.responded) return answer.result;
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    return settle(Promise.any([engine, hosted]).catch((error: AggregateError) => { throw error.errors[0]; }), callback);
  };
}
