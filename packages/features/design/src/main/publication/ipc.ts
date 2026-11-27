import { ipcMain, nativeTheme, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { isDesignDeliveryTicket } from '../../contracts/design-package.js';
import { designPublicationChannels as channels, parseBeginDesignPreview } from '../../contracts/design-publication.js';
import type { DesignMcpWindows } from '../mcp/ipc.js';
import { DesignPreviewPublications } from './design-preview-publications.js';
import type { DesignPackageMainHost } from './design-export-files.js';
import { importDesignPackageFromDisk, type DesignPackageImportHost } from './design-import-file.js';
import { DesignPreparedExports } from './design-prepared-exports.js';

export function registerDesignPublication(host: Pick<DesignMcpWindows, 'windowFor'> & DesignPackageMainHost & DesignPackageImportHost, scope: FeatureScope) {
  const previews = new DesignPreviewPublications();
  const exports = new DesignPreparedExports(host);
  const windows = new Map<number, { signal: AbortSignal; release(): Promise<void> }>();
  scope.add(() => previews.dispose());
  scope.add(() => exports.dispose());
  scope.add(async () => { await Promise.all([...windows.values()].map((owner) => owner.release())); });

  function ownerFor(contents: WebContents) {
    const id = contents.id;
    const previous = windows.get(id);
    if (previous) return previous;
    const controller = new AbortController();
    const release = async () => {
      controller.abort();
      windows.delete(id);
      previews.forget(id);
      contents.off('destroyed', forget);
      contents.off('did-start-navigation', navigate);
      contents.off('render-process-gone', forget);
      await exports.close(id);
    };
    const forget = () => { void release(); };
    const navigate = ({ isMainFrame, isSameDocument }: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (isMainFrame && !isSameDocument) forget();
    };
    contents.once('destroyed', forget);
    contents.on('did-start-navigation', navigate);
    contents.once('render-process-gone', forget);
    const owner = { signal: controller.signal, release };
    windows.set(id, owner);
    return owner;
  }

  function register(channel: string, action: (event: IpcMainInvokeEvent, signal: AbortSignal, ...args: unknown[]) => unknown) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!host.windowFor(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Desktop renderer is unavailable.');
      }
      const owner = ownerFor(event.sender);
      return scope.runOperation((signal) => action(event, signal, ...args), { signal: owner.signal });
    });
    scope.add(() => ipcMain.removeHandler(channel));
  }

  register(channels.importPackage, (_event, signal, source, destination) => importDesignPackageFromDisk(source, destination, host, signal));
  register(channels.prepareExport, ({ sender }, signal, id, input) => exports.prepare(sender.id, requireTicket(id), input, signal));
  register(channels.useExportFile, ({ sender }, signal, id, action) => {
    const window = host.windowFor(sender.id);
    if (!window || (action !== 'save' && action !== 'open' && action !== 'reveal')) {
      throw new Error('Invalid design export action.');
    }
    return exports.use(sender.id, window, requireTicket(id), action, signal);
  });
  register(channels.closeExport, ({ sender }, _signal, id) => exports.close(sender.id, requireTicket(id)));
  register(channels.previewStatus, () => previews.status());
  register(channels.beginPreview, ({ sender }, signal, input) => previews.begin(sender.id, parseBeginDesignPreview(input), signal));
  register(channels.appendPreviewBoard, ({ sender }, _signal, ticket, index, png) => previews.append(sender.id, requireTicket(ticket), index, png));
  register(channels.appendPreviewVariant, ({ sender }, _signal, ticket, board, variant, frame, png) =>
    previews.appendVariant(sender.id, requireTicket(ticket), board, variant, frame, png));
  register(channels.publishPreview, ({ sender }, signal, ticket) =>
    previews.publish(sender.id, requireTicket(ticket), signal, nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
  register(channels.cancelPreview, ({ sender }, _signal, ticket) => previews.cancel(sender.id, requireTicket(ticket)));
  register(channels.stopPreview, (_event, _signal, id) => previews.stop(requireTicket(id)));
}

function requireTicket(value: unknown): string {
  if (!isDesignDeliveryTicket(value)) throw new Error('Invalid design request ID.');
  return value;
}
