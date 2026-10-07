import type { BrowserWindow, Extension } from 'electron';
import type { BrowserExtensionPanel } from '../../contracts/extensions.js';
import type { ExtensionUiEvent } from '../../contracts/extension-api.js';
import { resolveExtensionPage } from './metadata.js';
import { ExtensionSidePanelOptions, panelPath } from './side-panel-options.js';

type OpenPanel = { owner: BrowserWindow; extension: Extension; tabId?: number; descriptor: BrowserExtensionPanel; closed(): void };

/** Owns panel lifecycle; the desktop renderer only hosts the selected, authenticated URL. */
export class BrowserExtensionSidePanels {
  readonly options = new ExtensionSidePanelOptions();
  private readonly open = new Map<number, OpenPanel>();
  constructor(private readonly changed: (owner: BrowserWindow) => void,
    private readonly notify: (id: string, event: ExtensionUiEvent) => void) {}

  snapshot(owner: BrowserWindow, tabId?: number): BrowserExtensionPanel | null {
    const current = this.open.get(owner.id);
    // The window host requests an unfiltered snapshot; tab callers still see only their panel.
    return current && (tabId === undefined || current.descriptor.webContentsId === undefined || current.descriptor.webContentsId === tabId)
      ? current.descriptor : null;
  }

  openEvents(id: string): ExtensionUiEvent[] {
    return [...this.open.values()].filter(({ extension }) => extension.id === id).map(({ owner, descriptor }) => ({
      kind: 'panelOpened', windowId: owner.id, path: panelPath(descriptor.url),
      ...(descriptor.webContentsId === undefined ? {} : { tabId: descriptor.webContentsId }),
    }));
  }

  show(extension: Extension, owner: BrowserWindow, tabId?: number, toggle = false): boolean {
    if (owner.isDestroyed()) return false;
    const options = this.options.get(extension, tabId);
    const url = options.enabled && resolveExtensionPage(extension.id, options.path);
    if (!url) return false;
    const scoped = this.options.tabSpecific(extension.id, tabId);
    const current = this.open.get(owner.id);
    if (current?.descriptor.id === extension.id && current.descriptor.url === url
      && current.descriptor.webContentsId === (scoped ? tabId : undefined)) {
      if (toggle) this.close(owner);
      return true;
    }
    this.close(owner);
    const closed = () => this.close(owner);
    const descriptor = { id: extension.id, url, ...(scoped ? { webContentsId: tabId } : {}) };
    this.open.set(owner.id, { owner, extension, tabId, descriptor, closed });
    owner.once('closed', closed);
    this.changed(owner);
    this.notify(extension.id, { kind: 'panelOpened', windowId: owner.id, path: panelPath(url), ...(scoped ? { tabId } : {}) });
    return true;
  }

  close(owner: BrowserWindow, extensionId?: string): boolean {
    const current = this.open.get(owner.id);
    if (!current || (extensionId && current.extension.id !== extensionId)) return false;
    this.open.delete(owner.id); owner.off('closed', current.closed);
    this.changed(owner);
    this.notify(current.extension.id, { kind: 'panelClosed', windowId: owner.id, path: panelPath(current.descriptor.url),
      ...(current.descriptor.webContentsId === undefined ? {} : { tabId: current.descriptor.webContentsId }) });
    return true;
  }

  refresh(extension: Extension): void {
    for (const current of [...this.open.values()]) {
      if (current.extension.id !== extension.id) continue;
      if (!this.show(extension, current.owner, current.tabId)) this.close(current.owner);
    }
  }

  forgetTab(tabId: number): void {
    this.options.forgetTab(tabId);
    for (const current of [...this.open.values()]) if (current.descriptor.webContentsId === tabId) this.close(current.owner);
  }

  remove(id: string): void {
    for (const current of [...this.open.values()]) if (current.extension.id === id) this.close(current.owner);
    this.options.remove(id);
  }

  dispose(): void { for (const current of [...this.open.values()]) this.close(current.owner); }
}
