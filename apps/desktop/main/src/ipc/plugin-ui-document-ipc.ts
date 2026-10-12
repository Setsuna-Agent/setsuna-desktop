import { parsePluginUiDocumentInput, PLUGIN_UI_DOCUMENT_CHANNELS, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { ipcMain } from 'electron';
import { PluginUiDocuments } from '../window/plugin-ui-documents.js';
import { desktopWindows } from '../window/registry.js';

let interfaceLanguage: () => RuntimeInterfaceLanguage = () => 'en-US';
const documents = new PluginUiDocuments(() => interfaceLanguage());

export function registerPluginUiDocumentIpc(language: () => RuntimeInterfaceLanguage = () => 'en-US'): void {
  interfaceLanguage = language;
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
