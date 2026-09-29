import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { BROWSER_IPC_CHANNELS, browserFeature } from '../contracts/index.js';
import {
  browserControlConnectionCapability,
  browserMainHostCapability,
} from './capabilities.js';
import { BrowserControlServer } from './control-server.js';
import { DesktopBrowserController } from './control.js';
import { BrowserContextMenuSession } from './context-menu-session.js';
import { registerBrowserIpc, type BrowserWindowSession } from './ipc.js';
import { installEmbeddedBrowserWebviews, publishBrowserOpenNewTab } from './webview.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(browserMainHostCapability),
});

export const browserMainFeature = defineMainFeature({
  definition: browserFeature,
  dependencies,
  provides: [declareCapabilityProvider(browserControlConnectionCapability)],
  async setup(context) {
    const { host } = context.dependencies;
    const windows = new Map<number, BrowserWindowSession>();
    const controller = new DesktopBrowserController({
      openTab: (url) => {
        const window = host.focusedWindow();
        return window ? publishBrowserOpenNewTab(window, url) : false;
      },
    });
    context.scope.add(host.onWindowAdded((window) => {
      const senderId = window.webContents.id;
      const contextMenus = new BrowserContextMenuSession((request) => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(BROWSER_IPC_CHANNELS.contextMenu, request);
        }
      });
      windows.set(senderId, { window, contextMenus });
      const uninstall = installEmbeddedBrowserWebviews({
        activeKeyboardShortcutBindings: () => host.activeKeyboardShortcutBindings(senderId),
        browserTabIdForWebContents: (webContentsId) => controller.tabIdForWebContents(webContentsId),
        interfaceLanguage: () => host.interfaceLanguage(),
        mainWindow: window,
        contextMenus,
      });
      return () => {
        windows.delete(senderId);
        contextMenus.dismiss();
        uninstall();
      };
    }));
    const controlServer = new BrowserControlServer({
      execute: (command, signal) => context.scope.runOperation(
        (scopeSignal) => controller.execute(command, scopeSignal),
        { signal },
      ),
    });
    const connection = await controlServer.start();

    context.scope.add(() => controlServer.stop());
    context.scope.add(() => controller.clear());
    context.scope.add(registerBrowserIpc(
      context.scope,
      controller,
      windows,
      () => host.interfaceLanguage(),
    ));
    context.provide(declareCapabilityProvider(browserControlConnectionCapability), connection);
  },
});
