import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { USER_SCRIPTS_CHANNELS as channels, type UserScriptsBootstrap } from '../contracts/user-scripts.js';
import { installUserScriptsApi } from './user-scripts-shim.js';
import { installUserScripts } from './user-scripts-runner.js';
import { initializeContentScripts } from './content-scripts.js';

export function initializeUserScripts(): void {
  const url = typeof location === 'object' ? location.href
    : String(contextBridge.executeInMainWorld({ func: () => globalThis.location.href }));
  if (url.startsWith('chrome-extension://')) {
    const bootstrap: UserScriptsBootstrap | null = ipcRenderer.sendSync(channels.bootstrap);
    if (bootstrap) contextBridge.executeInMainWorld({ func: installUserScriptsApi, args: [{
      call: (method: string, args: unknown[]) => ipcRenderer.invoke(channels.call, method, args),
      onEvent: (listener: (value: unknown) => void) => ipcRenderer.on(channels.event, (_event, value) => listener(value)),
    }, bootstrap] });
  } else if (typeof document === 'object' && /^https?:/.test(url)) {
    // Keep the remote lifetime port in this preload, away from page/user-script worlds.
    // Destroying the document closes it, including when an iframe is removed from the DOM.
    const lifetimePorts = new Set<MessagePort>();
    let documentId: string | null = null;
    ipcRenderer.on(channels.document, (event, id: string) => {
      documentId = id;
      for (const port of event.ports) {
        lifetimePorts.add(port);
        port.addEventListener('close', () => lifetimePorts.delete(port));
        port.start();
      }
    });
    initializeContentScripts(() => documentId);
    installUserScripts({
      plan: () => ipcRenderer.sendSync(channels.plan),
      message: (value) => ipcRenderer.invoke(channels.message, value),
      port: (value) => ipcRenderer.send(channels.port, value), answer: (value) => ipcRenderer.send(channels.answer, value),
      onPort: (listener) => { ipcRenderer.on(channels.port, (_event, value) => listener(value)); },
      onDeliver: (listener) => { ipcRenderer.on(channels.deliver, (_event, value) => listener(value)); },
      onExecute: (listener) => { ipcRenderer.on(channels.execute, (_event, value) => listener(value)); },
      onInvalidate: (listener) => { ipcRenderer.on(channels.invalidate, (_event, value) => listener(value)); },
      executeInMainWorld: (code) => webFrame.executeJavaScript(code),
      executeInIsolatedWorld: (worldId, code) => webFrame.executeJavaScriptInIsolatedWorld(worldId, [{ code }]),
      setIsolatedWorldInfo: (worldId, info) => webFrame.setIsolatedWorldInfo(worldId, info),
    });
  }
}
