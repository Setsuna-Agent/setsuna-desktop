import { ipcMain } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { BROWSER_IPC_CHANNELS } from '../../contracts/bridge.js';
import type { BrowserPasswordSession } from './session.js';

export function registerBrowserPasswordIpc(
  scope: FeatureScope,
  resolve: (tabId: string, senderId: number) => BrowserPasswordSession | null,
): () => void {
  const actions: Record<string, (session: BrowserPasswordSession, id: string, signal: AbortSignal) => unknown> = {
    [BROWSER_IPC_CHANNELS.getPasswordState]: (session: BrowserPasswordSession) => session.getState(),
    [BROWSER_IPC_CHANNELS.savePassword]: (session: BrowserPasswordSession, id: string) => session.save(id),
    [BROWSER_IPC_CHANNELS.dismissPassword]: (session: BrowserPasswordSession, id: string) => session.dismiss(id),
    [BROWSER_IPC_CHANNELS.fillPassword]: (session, id, signal) => session.fill(id, undefined, signal),
    [BROWSER_IPC_CHANNELS.deletePassword]: (session: BrowserPasswordSession, id: string) => session.delete(id),
  };
  for (const [channel, action] of Object.entries(actions)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, input) => scope.runOperation(async (signal) => {
      // A guest (including its subframes) cannot invoke host password actions.
      if (event.senderFrame !== event.sender.mainFrame || typeof input?.tabId !== 'string') return null;
      const session = resolve(input.tabId, event.sender.id);
      if (!session) return null;
      let cancel!: () => void;
      const cancelled = new Promise<null>((accept) => { cancel = () => accept(null); });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) return null;
        return await Promise.race([cancelled, Promise.resolve(action(session, typeof input.id === 'string' ? input.id : '', signal))]);
      }
      catch { throw new Error('Browser password operation failed.'); }
      finally { signal.removeEventListener('abort', cancel); }
    }));
  }
  return () => { for (const channel of Object.keys(actions)) ipcMain.removeHandler(channel); };
}
