import assert from 'node:assert/strict';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { BrowserWindow, WebContents } from 'electron';
import { DesktopBrowserController } from '../../src/main/control.js';
import { registerBrowserIpc } from '../../src/main/ipc.js';
import type { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';
import type { BrowserExtensionService } from '../../src/main/extensions/service.js';

async function until<T>(read: () => Promise<T>, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}

export async function verifyNavigationTargets(service: BrowserExtensionService, panel: WebContents, source: WebContents,
  owner: BrowserWindow, other: BrowserWindow): Promise<void> {
  const scope = createFeatureScope({ featureId: 'browser', scopeId: 'navigation-fixture', process: 'main' });
  const controller = new DesktopBrowserController();
  const windows = new Map([owner, other].map((window) => [window.webContents.id, { window, contextMenus: {} as BrowserContextMenuSession }]));
  scope.scope.add(registerBrowserIpc(scope.scope, controller, windows, () => 'en-US',
    (tabId, contents) => service.registerNavigationTarget(tabId, contents)));
  scope.scope.add(() => controller.clear()); scope.activate();
  const url = 'https://example.test/popup';
  const processId = source.mainFrame.processId;
  try {
    for (let index = 0; index < 2; index++) await source.executeJavaScript(`window.open(${JSON.stringify(url)}, '_blank'); null`, true);
    const targets: { id: string; contentsId: number }[] = await until(() => owner.webContents.executeJavaScript(`(() => {
      const targets =
      [...document.querySelectorAll('webview')].filter(view => view.id.startsWith('browser-') && view.dataset.registered === 'true')
        .map(view => ({id:view.id, contentsId:view.getWebContentsId()}));
      return targets.length === 2 && targets;
    })()`), 'requested targets create real webviews');
    const events = await until(() => panel.executeJavaScript(`chrome.storage.local.get('navigationTargets')
      .then(data => data.navigationTargets?.length === 2 && data.navigationTargets)`), 'real new-tab navigation events');
    assert.equal(targets.length, 2); assert.notEqual(targets[0].id, targets[1].id);
    assert.deepEqual(events.map((event: { tabId: number }) => event.tabId).sort(), targets.map((target) => target.contentsId).sort());
    for (const event of events) {
      assert.equal(event.sourceTabId, source.id); assert.equal(event.sourceProcessId, processId);
      assert.equal(event.sourceFrameId, 0); assert.equal(event.url, url);
      assert.equal(typeof event.timeStamp, 'number');
    }
    for (const target of targets) assert.equal(controller.tabIdForWebContents(target.contentsId), target.id);
    assert.equal(await other.webContents.executeJavaScript(`navigationFixture.registerTab(${JSON.stringify(targets[0].id)}, ${targets[0].contentsId})`), false);
  } finally { await scope.finishDispose(); }
}
