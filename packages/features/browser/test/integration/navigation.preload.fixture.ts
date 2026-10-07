import { contextBridge } from 'electron';
import type { BrowserDesktopBridge } from '../../src/contracts/bridge.js';
import { DESKTOP_BROWSER_PARTITION } from '../../src/contracts/index.js';
import { browserPreloadFeature } from '../../src/preload/feature.js';

// Exercise the production desktop bridge. Only tab creation replaces the React host.
browserPreloadFeature.contribute({ set: (_key, bridge) => contextBridge.exposeInMainWorld('navigationFixture', bridge) });
contextBridge.executeInMainWorld({ func: (partition: string) => {
  const bridge = (window as unknown as { navigationFixture: BrowserDesktopBridge }).navigationFixture;
  bridge.onOpenNewTab(({ tabId, url }) => {
    if (!tabId) throw new Error('The intercepted target has no workspace tab ID.');
    const view = document.createElement('webview') as Electron.WebviewTag;
    view.id = tabId; view.setAttribute('partition', partition); view.setAttribute('allowpopups', ''); view.src = url;
    view.addEventListener('dom-ready', () => {
      void bridge.registerTab(tabId, view.getWebContentsId()).then((registered) => { view.dataset.registered = String(registered); });
    });
    document.body.appendChild(view);
  });
}, args: [DESKTOP_BROWSER_PARTITION] });
