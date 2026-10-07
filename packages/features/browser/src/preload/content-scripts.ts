import { ipcRenderer, webFrame } from 'electron';
import { USER_SCRIPTS_CHANNELS as channels, type ContentScriptExecution, type UserScriptsInvalidation } from '../contracts/user-scripts.js';

/** Share the user-script transport's document identity; page worlds receive no IPC bridge. */
export function initializeContentScripts(documentId: () => string | null): void {
  const worlds = new Map<string, number>();
  const generations = new Map<string, number>();
  ipcRenderer.on(channels.invalidate, (_event, { extensionId }: UserScriptsInvalidation) => {
    generations.set(extensionId, (generations.get(extensionId) ?? 0) + 1);
  });
  ipcRenderer.on(channels.scripting, (_event, execution: ContentScriptExecution) => {
    if (execution.documentId !== documentId()) return;
    const generation = generations.get(execution.extensionId) ?? 0;
    const check = () => {
      if (execution.documentId !== documentId() || (generations.get(execution.extensionId) ?? 0) !== generation) {
        throw new Error('Script execution cancelled.');
      }
    };
    const run = async () => {
      if (!execution.injectImmediately) await documentIdle();
      check();
      let world = worlds.get(execution.extensionId);
      if (execution.world === 'ISOLATED' && world === undefined) {
        // Distinct from preload (999), native content scripts and user-script worlds (100000+).
        world = 200_000 + worlds.size;
        worlds.set(execution.extensionId, world);
        webFrame.setIsolatedWorldInfo(world, { name: `Setsuna scripting ${execution.extensionId}`,
          securityOrigin: `chrome-extension://${execution.extensionId}`, csp: "script-src 'self' 'unsafe-eval'" });
      }
      let result: unknown;
      for (const code of execution.code) {
        check();
        result = await (execution.world === 'MAIN' ? webFrame.executeJavaScript(code)
          : webFrame.executeJavaScriptInIsolatedWorld(world!, [{ code }]));
      }
      return result;
    };
    void run().then(result => ipcRenderer.send(channels.answer, { token: execution.token, result }),
      error => ipcRenderer.send(channels.answer, { token: execution.token, error: error instanceof Error ? error.message : String(error) }));
  });
}

async function documentIdle(): Promise<void> {
  const complete = () => document.readyState === 'complete';
  if (complete()) return;
  if (document.readyState === 'loading') await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  if (complete()) return;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); window.removeEventListener('load', finish); resolve(); };
    const timer = setTimeout(finish, 200);
    window.addEventListener('load', finish, { once: true });
  });
}
