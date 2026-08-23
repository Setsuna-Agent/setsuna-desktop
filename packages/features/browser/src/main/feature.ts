import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { browserFeature } from '../contracts/index.js';
import {
  browserControlConnectionCapability,
  browserMainHostCapability,
} from './capabilities.js';
import { BrowserControlServer } from './control-server.js';
import { DesktopBrowserController } from './control.js';
import { registerBrowserIpc } from './ipc.js';
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
    const controller = new DesktopBrowserController({
      openTab: (url) => publishBrowserOpenNewTab(host.mainWindow, url),
    });
    const controlServer = new BrowserControlServer({
      execute: (command, signal) => context.scope.runOperation(
        (scopeSignal) => controller.execute(command, scopeSignal),
        { signal },
      ),
    });
    const connection = await controlServer.start();

    context.scope.add(() => controlServer.stop());
    context.scope.add(() => controller.clear());
    context.scope.add(registerBrowserIpc(context.scope, controller, host.mainWindow));
    context.scope.add(installEmbeddedBrowserWebviews({
      activeKeyboardShortcutBindings: () => host.activeKeyboardShortcutBindings(),
      interfaceLanguage: () => host.interfaceLanguage(),
      mainWindow: host.mainWindow,
    }));
    context.provide(declareCapabilityProvider(browserControlConnectionCapability), connection);
  },
});
