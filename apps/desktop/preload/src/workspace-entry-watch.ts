import { WORKSPACE_ENTRIES_WATCH_CHANNELS, type SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import { ipcRenderer, type IpcRendererEvent } from 'electron';

export const watchWorkspaceEntries: SetsunaDesktopBridge['desktop']['watchWorkspaceEntries'] = (
  workspaceRoot, directoryPaths, callback,
) => {
  const channels = WORKSPACE_ENTRIES_WATCH_CHANNELS;
  const subscriptionId = globalThis.crypto.randomUUID();
  let cancelled = false;
  const listener = (_event: IpcRendererEvent, payload: { subscriptionId: string }) => {
    if (!cancelled && payload.subscriptionId === subscriptionId) callback();
  };
  ipcRenderer.on(channels.changed, listener);
  void ipcRenderer.invoke(channels.subscribe, { subscriptionId, workspaceRoot, directoryPaths }).then(() => {
    // Re-read once after attachment to close the gap between the initial listing and watching.
    if (!cancelled) callback();
  }).catch((error: unknown) => {
    if (!cancelled) console.error(error);
  });
  return () => {
    cancelled = true;
    ipcRenderer.off(channels.changed, listener);
    void ipcRenderer.invoke(channels.unsubscribe, subscriptionId);
  };
};
