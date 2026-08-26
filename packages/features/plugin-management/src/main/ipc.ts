import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain } from 'electron';
import { PLUGIN_MANAGEMENT_IPC_CHANNELS } from '../contracts/index.js';
import type { PluginManagementMainHost } from './capabilities.js';
import { localPluginBundleDialogTitle } from './messages.js';

export function registerPluginManagementIpc(
  scope: FeatureScope,
  host: PluginManagementMainHost,
): () => void {
  const channel = PLUGIN_MANAGEMENT_IPC_CHANNELS.installLocal;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event) => scope.runOperation(async () => {
    if (!host.isRendererSender(event.sender.id)) return null;
    const sourcePath = await host.selectLocalBundle(
      localPluginBundleDialogTitle(host.interfaceLanguage()),
    );
    return sourcePath ? host.installLocal(sourcePath) : null;
  }));
  return () => ipcMain.removeHandler(channel);
}
