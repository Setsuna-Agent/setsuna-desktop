import { WORKSPACE_ENTRIES_WATCH_CHANNELS, type DesktopWorkspaceEntriesWatchInput } from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import { watchWorkspaceEntries } from '../workspace/entry-watcher.js';
import { isDesktopRendererSender } from './sender.js';

export function registerWorkspaceEntryWatchIpc(mainWindow: BrowserWindow): void {
  const channels = WORKSPACE_ENTRIES_WATCH_CHANNELS;
  const subscriptions = new Map<string, { dispose: () => void }>();
  const stop = (id: string) => {
    const subscription = subscriptions.get(id);
    subscriptions.delete(id);
    subscription?.dispose();
  };
  const stopAll = () => { for (const id of subscriptions.keys()) stop(id); };
  ipcMain.removeHandler(channels.subscribe);
  ipcMain.removeHandler(channels.unsubscribe);
  ipcMain.handle(channels.subscribe, async (event, input: DesktopWorkspaceEntriesWatchInput) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) throw new Error('Desktop renderer is unavailable.');
    if (!input || typeof input.subscriptionId !== 'string' || !input.subscriptionId) throw new Error('Subscription id is required.');
    const id = input.subscriptionId;
    stop(id);
    const subscription: { dispose: () => void } = { dispose: () => undefined };
    subscriptions.set(id, subscription);
    try {
      const dispose = await watchWorkspaceEntries(input.workspaceRoot, input.directoryPaths, () => {
        if (subscriptions.get(id) === subscription && !event.sender.isDestroyed()) {
          event.sender.send(channels.changed, { subscriptionId: id });
        }
      });
      // Each consumer owns its watcher. Unsubscribe/navigation can overtake path resolution.
      if (subscriptions.get(id) !== subscription) dispose();
      else subscription.dispose = dispose;
    } catch (error) {
      if (subscriptions.get(id) === subscription) stop(id);
      throw error;
    }
  });
  ipcMain.handle(channels.unsubscribe, (event, subscriptionId: string) => {
    if (isDesktopRendererSender(event.sender, mainWindow)) stop(subscriptionId);
  });
  mainWindow.webContents.on('destroyed', stopAll);
  mainWindow.webContents.on('render-process-gone', stopAll);
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) stopAll();
  });
}
