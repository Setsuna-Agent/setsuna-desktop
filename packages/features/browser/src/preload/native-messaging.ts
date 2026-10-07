import type { ExtensionApiResult, ExtensionSystemEvent } from '../contracts/extension-api.js';

export function installNativeMessaging(transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
  onEvent(listener: (event: ExtensionSystemEvent) => void): void;
}): void {
  type Listener = (...args: unknown[]) => void;
  const runtime = (globalThis as unknown as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
  if (!runtime) return;
  const ports = new Map<string, { receive(message: unknown): void; closed(error?: string): void; disconnect(): void }>();
  const event = () => {
    const listeners = new Set<Listener>();
    return { addListener(listener: Listener) { if (typeof listener !== 'function') throw new TypeError('Expected a listener.'); listeners.add(listener); },
      removeListener: (listener: Listener) => listeners.delete(listener), hasListener: (listener: Listener) => listeners.has(listener), hasListeners: () => listeners.size > 0,
      emit: (...args: unknown[]) => { for (const listener of [...listeners]) { try { listener(...args); } catch (error) { console.error(error); } } } };
  };
  const withError = (message: string | undefined, callback: () => void) => {
    const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
    if (message) Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message } });
    try { callback(); }
    finally { if (previous) Object.defineProperty(runtime, 'lastError', previous); else delete runtime.lastError; }
  };
  const invoke = async (method: string, args: unknown[]) => {
    const reply = await transport.call(`nativeMessaging.${method}`, args);
    if (!reply.ok) throw new Error(reply.error);
  };
  const connect = (name: string) => {
    if (typeof name !== 'string') throw new TypeError('Expected a native messaging host name.');
    const portId = crypto.randomUUID();
    const onMessage = event(); const onDisconnect = event();
    let disconnected = false;
    const closed = (error?: string) => {
      if (disconnected) return;
      disconnected = true; ports.delete(portId);
      withError(error, () => onDisconnect.emit(port));
    };
    const ready = invoke('connect', [portId, name]);
    let queue = ready;
    const port = { name, onMessage, onDisconnect,
      postMessage(message: unknown) {
        if (disconnected) throw new Error('Attempting to use a disconnected port object.');
        // Match Chrome's synchronous JSON serialization errors before crossing IPC.
        const json = JSON.stringify(message);
        if (json === undefined) throw new TypeError('Native message must be JSON serializable.');
        const value: unknown = JSON.parse(json);
        queue = queue.then(() => { if (!disconnected) return invoke('postMessage', [portId, value]); });
        void queue.catch((error: Error) => closed(error.message));
      },
      disconnect() {
        if (disconnected) return;
        disconnected = true; ports.delete(portId);
        void ready.then(() => invoke('disconnect', [portId])).catch(() => undefined);
      },
    };
    ports.set(portId, { receive: (message) => onMessage.emit(message, port), closed, disconnect: () => port.disconnect() });
    void ready.catch((error: Error) => closed(error.message));
    return port;
  };
  runtime.connectNative = connect;
  runtime.sendNativeMessage = (name: string, message: unknown, callback?: Listener) => {
    const result = new Promise<unknown>((resolve, reject) => {
      const json = JSON.stringify(message);
      if (json === undefined) throw new TypeError('Native message must be JSON serializable.');
      const port = connect(name);
      port.onMessage.addListener((reply) => { resolve(reply); port.disconnect(); });
      port.onDisconnect.addListener(() => reject(new Error((runtime.lastError as { message?: string } | undefined)?.message ?? 'Native host has exited.')));
      port.postMessage(JSON.parse(json));
    });
    if (!callback) return result;
    void result.then((reply) => callback(reply), (error: Error) => withError(error.message, () => callback()));
    return undefined;
  };
  transport.onEvent((value) => {
    if (value.kind === 'nativeMessage') ports.get(value.portId)?.receive(value.message);
    if (value.kind === 'nativeDisconnect') ports.get(value.portId)?.closed(value.error);
  });
  globalThis.addEventListener('pagehide', () => { for (const port of [...ports.values()]) port.disconnect(); });
}
