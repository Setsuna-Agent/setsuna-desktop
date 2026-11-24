import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { designMcpChannels, designMcpClients, type DesignMcpClient, type DesignMcpReply } from '../../contracts/design-mcp.js';
import { DesignMcpCanvasBroker } from './canvas-broker.js';
import type { DesignMcpIntegration } from './integration.js';

export type DesignMcpWindows = {
  windowFor(senderId: number): BrowserWindow | null;
  onWindowAdded(listener: (window: BrowserWindow) => () => void): () => void;
};

export function registerDesignMcpCanvas(windows: DesignMcpWindows, scope: FeatureScope): DesignMcpCanvasBroker {
  const recent: BrowserWindow[] = [];
  const canvas = new DesignMcpCanvasBroker(() => {
    const window = recent.at(-1);
    if (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()) return window.webContents.id;
  }, (sender, event) => {
    const contents = windows.windowFor(sender)?.webContents;
    if (!contents || contents.isDestroyed()) return false;
    try {
      contents.send(designMcpChannels.request, event);
      return true;
    } catch {
      return false;
    }
  });
  scope.add(windows.onWindowAdded((window) => {
    const contents = window.webContents;
    const senderId = contents.id;
    const remove = () => {
      const index = recent.indexOf(window);
      if (index >= 0) recent.splice(index, 1);
    };
    const focus = () => { remove(); recent.push(window); canvas.activeChanged(); };
    const update = () => canvas.activeChanged();
    const forget = () => canvas.forget(senderId);
    const navigate = ({ isMainFrame, isSameDocument }: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (isMainFrame && !isSameDocument) forget();
    };
    recent.unshift(window);
    if (window.isFocused()) focus();
    window.on('focus', focus);
    window.on('minimize', update);
    window.on('hide', update);
    contents.on('did-start-navigation', navigate);
    contents.on('render-process-gone', forget);
    return () => {
      remove();
      forget();
      window.off('focus', focus);
      window.off('minimize', update);
      window.off('hide', update);
      contents.off('did-start-navigation', navigate);
      contents.off('render-process-gone', forget);
    };
  }));
  const trusted = (event: IpcMainEvent) =>
    Boolean(windows.windowFor(event.sender.id)) && event.senderFrame === event.sender.mainFrame && !scope.signal.aborted;
  const setCanvas = (event: IpcMainEvent, id: unknown, visible: unknown) => {
    if (trusted(event) && typeof id === 'string' && id.length > 0 && id.length <= 64 && typeof visible === 'boolean') {
      canvas.setCanvas(event.sender.id, id, visible);
    }
  };
  const reply = (event: IpcMainEvent, id: unknown, value: unknown) => {
    if (trusted(event) && typeof id === 'string' && validReply(value)) canvas.reply(event.sender.id, id, value);
  };
  ipcMain.on(designMcpChannels.canvas, setCanvas);
  ipcMain.on(designMcpChannels.reply, reply);
  scope.add(() => {
    ipcMain.off(designMcpChannels.canvas, setCanvas);
    ipcMain.off(designMcpChannels.reply, reply);
  });
  return canvas;
}

export function registerDesignMcpSettings(windows: DesignMcpWindows, scope: FeatureScope, integration: DesignMcpIntegration): void {
  const run = <T>(event: IpcMainInvokeEvent, operation: (signal: AbortSignal) => Promise<T>) => {
    if (!windows.windowFor(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Desktop renderer is unavailable.');
    return scope.runOperation(operation);
  };
  ipcMain.handle(designMcpChannels.settings, (event) => run(event, (signal) => integration.settings(signal)));
  ipcMain.handle(designMcpChannels.copyConfig, (event) => run(event, (signal) => integration.copyConfig(signal)));
  ipcMain.handle(designMcpChannels.revokeManual, (event) => run(event, (signal) => integration.revokeManual(signal)));
  ipcMain.handle(designMcpChannels.setEnabled, (event, client: DesignMcpClient, enabled: unknown) => run(event, (signal) => {
    if (!designMcpClients.includes(client) || typeof enabled !== 'boolean') throw new Error('Invalid design MCP client.');
    return integration.setEnabled(client, enabled, signal);
  }));
  scope.add(() => {
    ipcMain.removeHandler(designMcpChannels.settings);
    ipcMain.removeHandler(designMcpChannels.setEnabled);
    ipcMain.removeHandler(designMcpChannels.copyConfig);
    ipcMain.removeHandler(designMcpChannels.revokeManual);
  });
}

function validReply(value: unknown): value is DesignMcpReply {
  const reply = value as DesignMcpReply | null | undefined;
  if (reply?.ok === false) return typeof reply.error === 'string' && reply.error.length <= 8_192;
  if (reply?.ok !== true || typeof reply.value?.content !== 'string' || reply.value.content.length > 100_000) return false;
  const { image } = reply.value;
  return image === undefined || (typeof image === 'string' && image.length <= 6_000_000 && image.startsWith('data:image/png;base64,'));
}
