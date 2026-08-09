import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { createNativeTranslate } from '../i18n/native-messages.js';
import type { RuntimeHost } from '../runtime/host.js';
import { isDesktopRendererSender } from './sender.js';

const INSTALL_LOCAL_PLUGIN_CHANNEL = 'desktop-plugin:install-local';

export function registerPluginIpc(
  runtimeHost: RuntimeHost,
  mainWindow: BrowserWindow,
  getInterfaceLanguage: () => RuntimeInterfaceLanguage,
): void {
  ipcMain.removeHandler(INSTALL_LOCAL_PLUGIN_CHANNEL);
  ipcMain.handle(INSTALL_LOCAL_PLUGIN_CHANNEL, async (event) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return null;
    const t = createNativeTranslate(getInterfaceLanguage());
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: t('plugins.installLocal.title'),
      properties: ['openDirectory'],
    });
    if (selection.canceled) return null;
    const sourcePath = selection.filePaths[0];
    return sourcePath ? runtimeHost.installLocalPluginBundle(sourcePath) : null;
  });
}
