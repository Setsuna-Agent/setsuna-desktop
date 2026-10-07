import type { ExtensionApiResult } from '../contracts/extension-api.js';

/** Serialized into extension frames/workers. Native validation and host grants stay first. */
export function installExtensionScripting(transport: {
  call(method: string, args: unknown[]): Promise<ExtensionApiResult>;
}): void {
  const chrome = (globalThis as unknown as { chrome?: { scripting?: Record<string, unknown>; runtime?: { lastError?: { message: string } } } }).chrome;
  const scripting = chrome?.scripting;
  const runtime = chrome?.runtime;
  const native = scripting?.executeScript;
  if (!scripting || !runtime || typeof native !== 'function') return;
  scripting.executeScript = (injection: Record<string, unknown>, callback?: (value?: unknown) => void) => {
    if (callback !== undefined && typeof callback !== 'function') return native.call(scripting, injection, callback);
    let input: unknown;
    try {
      const snapshot = { ...injection };
      if (typeof snapshot.func === 'function') snapshot.func = Function.prototype.toString.call(snapshot.func);
      input = JSON.parse(JSON.stringify(snapshot));
    } catch { /* Invalid/nonserializable injections keep the native error. */ }
    const result = Promise.resolve(native.call(scripting, injection)).catch(async original => {
      // Chromium's host-access errors (manifest_constants.h). Never repeat a script
      // after an execution/validation failure, or it could produce side effects twice.
      if (!input || !/^Cannot access contents of (?:the page|url )/.test(original?.message ?? '')) throw original;
      const reply = await transport.call('scripting.executeScript', [input]);
      if (!reply.ok) throw new Error(reply.error);
      const fallback = reply.result as { handled: boolean; result?: unknown };
      if (!fallback.handled) throw original;
      return fallback.result;
    });
    if (!callback) return result;
    void result.then(value => callback(value), (error: Error) => {
      const previous = Object.getOwnPropertyDescriptor(runtime, 'lastError');
      Object.defineProperty(runtime, 'lastError', { configurable: true, value: { message: error.message } });
      try { callback(); }
      finally { if (previous) Object.defineProperty(runtime, 'lastError', previous); else delete runtime.lastError; }
    });
    return undefined;
  };
}
