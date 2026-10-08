import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { app, session } from 'electron';
import path from 'node:path';
import { BROWSER_SETTINGS_CHANNELS } from '../contracts/settings.js';
import { BrowserPreferencesStore } from './settings/preferences.js';
import { registerBrowserSettingsIpc } from './settings/ipc.js';
import { installBrowserPermissions } from './settings/permissions.js';
import { installBrowserDownloads } from './settings/downloads.js';
import { BROWSER_IPC_CHANNELS, DESKTOP_BROWSER_PARTITION, browserFeature } from '../contracts/index.js';
import {
  browserControlConnectionCapability,
  browserMainHostCapability,
} from './capabilities.js';
import { BrowserControlServer } from './control-server.js';
import { BrowserPasswordStore } from './passwords/store.js';
import { registerBrowserPasswordIpc } from './passwords/ipc.js';
import { BrowserExtensionService } from './extensions/service.js';
import { registerBrowserExtensionIpc } from './extensions/ipc.js';
import { BrowserImportService } from './import/service.js';
import { browserProfileRoots } from './import/profiles.js';
import { registerBrowserImportIpc } from './import/ipc.js';
import { isAllowedEmbeddedBrowserUrl } from './new-tab.js';
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
    const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
    const preferences = new BrowserPreferencesStore(path.join(browserSession.storagePath!, 'browser-settings.json'));
    await preferences.load();
    const passwords = new BrowserPasswordStore(host.passwordStorage);
    const resolveOwner = (senderId: number) => windows.get(senderId)?.window ?? null;
    const applyPreferences = () => { browserSession.spellCheckerEnabled = preferences.get().spellcheck; };
    applyPreferences();
    context.scope.add(preferences.subscribe((value) => {
      applyPreferences();
      for (const { window } of windows.values()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(BROWSER_SETTINGS_CHANNELS.changed, value);
      }
    }));
    context.scope.add(installBrowserPermissions(browserSession, preferences,
      (contents) => resolveOwner(contents.hostWebContents?.id ?? -1), () => host.interfaceLanguage()));
    context.scope.add(installBrowserDownloads(browserSession, preferences));
    context.scope.add(registerBrowserSettingsIpc(context.scope, preferences, passwords, browserSession, resolveOwner));
    const extensions = new BrowserExtensionService({
      signal: context.scope.signal,
      preloadPath: host.extensionPreloadPath,
      session: session.fromPartition(DESKTOP_BROWSER_PARTITION),
      language: () => host.interfaceLanguage(),
      owner: (contents) => windows.get(contents.hostWebContents?.id ?? -1)?.window ?? null,
      activeOwner: () => host.focusedWindow(),
      windows: () => [...windows.values()].map(({ window }) => window),
      publish: (items) => {
        for (const { window } of windows.values()) {
          if (!window.isDestroyed()) window.webContents.send(BROWSER_IPC_CHANNELS.extensionsChanged, items);
        }
      },
      openWebPage: (owner, url) => {
        if (isAllowedEmbeddedBrowserUrl(url)) publishBrowserOpenNewTab(owner, url);
      },
      actionsChanged: (webContentsId) => {
        for (const { window } of windows.values()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(BROWSER_IPC_CHANNELS.extensionActionsChanged, webContentsId);
          }
        }
      },
    });
    context.scope.add(() => extensions.dispose());
    const importer = new BrowserImportService(browserProfileRoots(process.platform, app.getPath('home'), process.env.LOCALAPPDATA),
      extensions, () => app.getLocale());
    context.scope.add(registerBrowserImportIpc(context.scope, importer, resolveOwner));
    const controller = new DesktopBrowserController({
      passwordStore: passwords,
      preferences: () => preferences.get(),
      openTab: (url) => {
        const window = host.focusedWindow();
        return window ? publishBrowserOpenNewTab(window, url) : false;
      },
    });
    context.scope.add(preferences.subscribe(() => controller.refreshPasswordPreferences()));
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
        extensionMenuItems: (contents, params) => extensions.contextMenuItems(contents, params),
        onNewTabRequested: (contents, url) => extensions.requestNavigationTarget(contents, url),
        permissionsManaged: true,
        isAllowedExtensionUrl: (url) => extensions.allowsPage(url),
        onGuestAttached: (contents) => {
          let lastZoom = preferences.get().defaultZoom;
          const zoom = () => { if (!contents.isDestroyed()) contents.setZoomFactor(preferences.get().defaultZoom); };
          contents.on('did-navigate', zoom);
          const unsubscribe = preferences.subscribe((value) => {
            if (value.defaultZoom === lastZoom) return;
            lastZoom = value.defaultZoom;
            zoom();
          });
          const untrack = extensions.track(contents);
          return () => { contents.off('did-navigate', zoom); unsubscribe(); untrack(); };
        },
      });
      return () => {
        windows.delete(senderId);
        contextMenus.dismiss();
        uninstall();
      };
    }));
    const controlServer = new BrowserControlServer({
      execute: (command, signal) => context.scope.runOperation(
        (scopeSignal) => {
          if (!preferences.get().agentControl) throw new Error('Browser control is disabled in browser settings.');
          return controller.execute(command, scopeSignal);
        },
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
      (tabId, contents) => extensions.registerNavigationTarget(tabId, contents),
    ));
    context.scope.add(registerBrowserPasswordIpc(context.scope, (tabId, senderId) => (
      windows.has(senderId) ? controller.passwordSession(tabId, senderId) : null
    )));
    context.scope.add(registerBrowserExtensionIpc(context.scope, extensions, (senderId) => windows.get(senderId)?.window ?? null));
    context.provide(declareCapabilityProvider(browserControlConnectionCapability), connection);
    // Third-party restoration must never gate the control server, runtime or first paint.
    void extensions.start().catch((error: unknown) => {
      if (!context.scope.signal.aborted) console.error('[browser-extensions] failed to restore extensions', error);
    });
  },
});
