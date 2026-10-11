import { parsePluginUiDocumentInput, PLUGIN_UI_DOCUMENT_CHANNELS } from '@setsuna-desktop/contracts';
import { ipcMain } from 'electron';
import { PluginUiDocuments } from '../window/plugin-ui-documents.js';
import { desktopWindows } from '../window/registry.js';

const documents = new PluginUiDocuments();

export function registerPluginUiDocumentIpc(): void {
  for (const channel of Object.values(PLUGIN_UI_DOCUMENT_CHANNELS)) ipcMain.removeHandler(channel);
  ipcMain.handle(PLUGIN_UI_DOCUMENT_CHANNELS.create, (event, input: unknown) => {
    const owner = desktopWindows.get(event.sender.id);
    if (!owner || event.senderFrame !== event.sender.mainFrame) throw new Error('Desktop renderer is unavailable.');
    return documents.create(owner, parsePluginUiDocumentInput(input));
  });
  ipcMain.handle(PLUGIN_UI_DOCUMENT_CHANNELS.release, (event, id: unknown) => {
    if (!desktopWindows.get(event.sender.id) || event.senderFrame !== event.sender.mainFrame) return;
    if (typeof id === 'string') documents.release(event.sender.id, id);
  });
}
