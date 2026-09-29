import { WORKSPACE_ENTRIES_WATCH_CHANNELS, type DesktopWorkspaceEntriesWatchInput } from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import { watchWorkspaceEntries } from '../workspace/entry-watcher.js';
import { desktopWindows } from '../window/registry.js';
import { isDesktopRendererSender } from './sender.js';

export function registerWorkspaceEntryWatchIpc(): void {
  const channels = WORKSPACE_ENTRIES_WATCH_CHANNELS;
  const subscriptions = new Map<string, { senderId: number; dispose: () => void }>();
  const stop = (id: string) => {
    const subscription = subscriptions.get(id);
    subscriptions.delete(id);
    subscription?.dispose();
  };
  const stopSender = (senderId: number) => {
    for (const [id, subscription] of subscriptions) if (subscription.senderId === senderId) stop(id);
  };
  ipcMain.removeHandler(channels.subscribe);
  ipcMain.removeHandler(channels.unsubscribe);
  ipcMain.handle(channels.subscribe, async (event, input: DesktopWorkspaceEntriesWatchInput) => {
    if (!isDesktopRendererSender(event.sender)) throw new Error('Desktop renderer is unavailable.');
    if (!input || typeof input.subscriptionId !== 'string' || !input.subscriptionId) throw new Error('Subscription id is required.');
    const id = `${event.sender.id}:${input.subscriptionId}`;
    stop(id);
    const subscription = { senderId: event.sender.id, dispose: () => undefined as void };
    subscriptions.set(id, subscription);
    try {
      const dispose = await watchWorkspaceEntries(input.workspaceRoot, input.directoryPaths, () => {
        if (subscriptions.get(id) === subscription && !event.sender.isDestroyed()) {
          event.sender.send(channels.changed, { subscriptionId: input.subscriptionId });
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
    if (isDesktopRendererSender(event.sender)) stop(`${event.sender.id}:${subscriptionId}`);
  });
  const observe = (window: BrowserWindow) => {
    const senderId = window.webContents.id;
    const stopAll = () => stopSender(senderId);
    const navigate = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) stopAll();
    };
    window.webContents.on('destroyed', stopAll);
    window.webContents.on('render-process-gone', stopAll);
    window.webContents.on('did-start-navigation', navigate);
    return () => {
      stopAll();
      window.webContents.off('destroyed', stopAll);
      window.webContents.off('render-process-gone', stopAll);
      window.webContents.off('did-start-navigation', navigate);
    };
  };
  desktopWindows.onWindowAdded(observe);
}
