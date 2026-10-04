import { ipcMain, webContents, type BrowserWindow } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { BROWSER_IPC_CHANNELS } from '../../contracts/bridge.js';
import type { BrowserExtensionService } from './service.js';
import type { BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';

export function registerBrowserExtensionIpc(
  scope: FeatureScope, service: BrowserExtensionService, resolveOwner: (senderId: number) => BrowserWindow | null,
): () => void {
  const channels = [BROWSER_IPC_CHANNELS.getExtensions, BROWSER_IPC_CHANNELS.getExtensionActions,
    BROWSER_IPC_CHANNELS.removeExtension, BROWSER_IPC_CHANNELS.openExtension];
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, input) => scope.runOperation(async (signal) => {
      const owner = resolveOwner(event.sender.id);
      if (!owner || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame || signal.aborted) return null;
      if (channel === BROWSER_IPC_CHANNELS.getExtensions) return service.list();
      const guestId = input?.webContentsId;
      if (guestId !== undefined) {
        const guest = typeof guestId === 'number' && Number.isSafeInteger(guestId) ? webContents.fromId(guestId) : null;
        if (!guest || guest.isDestroyed() || guest.hostWebContents?.id !== owner.webContents.id
          || !service.ownsGuest(guest)) return null;
      }
      if (channel === BROWSER_IPC_CHANNELS.getExtensionActions) return service.actions.snapshot(guestId);
      if (typeof input?.id !== 'string') return false;
      try {
        if (channel === BROWSER_IPC_CHANNELS.removeExtension) return await service.remove(input.id);
        if (input.view !== 'popup' && input.view !== 'options') return false;
        if (input.anchor !== undefined && !validAnchor(input.anchor)) return false;
        return await service.open(input.id, input.view, owner, input.anchor, guestId);
      } catch { throw new Error('Browser extension operation failed.'); }
    }));
  }
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}

function validAnchor(value: unknown): value is BrowserExtensionPopupAnchor {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((key) => typeof anchor[key] === 'number'
    && Number.isFinite(anchor[key]) && anchor[key] >= 0 && anchor[key] <= 100_000);
}
