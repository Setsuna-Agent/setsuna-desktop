import { contextBridge, ipcRenderer } from 'electron';
import { PLUGIN_UI_DOCUMENT_CHANNELS, type PluginUiDocumentInput } from '@setsuna-desktop/contracts';

contextBridge.exposeInMainWorld('setsunaDesktop', { desktop: {
  createPluginUiDocument: (input: PluginUiDocumentInput) => ipcRenderer.invoke(PLUGIN_UI_DOCUMENT_CHANNELS.create, input),
  releasePluginUiDocument: (id: string) => ipcRenderer.invoke(PLUGIN_UI_DOCUMENT_CHANNELS.release, id),
} });
