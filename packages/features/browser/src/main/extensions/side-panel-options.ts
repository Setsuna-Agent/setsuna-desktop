import type { Extension } from 'electron';
import { extensionPageUrl, resolveExtensionPage } from './metadata.js';

export type ExtensionPanelOptions = { enabled: boolean; path?: string; tabId?: number };

/** Tab options replace the global configuration, as in Chrome; they do not leak between tabs. */
export class ExtensionSidePanelOptions {
  private readonly options = new Map<string, Map<number | null, ExtensionPanelOptions>>();
  private readonly behaviors = new Map<string, boolean>();

  get(extension: Extension, tabId?: number): ExtensionPanelOptions {
    const entries = this.options.get(extension.id);
    const options = entries?.get(tabId ?? null) ?? entries?.get(null);
    const url = extensionPageUrl(extension, 'sidepanel');
    return { ...(options ?? { enabled: Boolean(url), ...(url ? { path: panelPath(url) } : {}) }),
      ...(tabId === undefined ? {} : { tabId }) };
  }

  set(extension: Extension, input: Record<string, unknown>, ownsTab: (id: number) => boolean): void {
    const tabId = panelTabId(input.tabId, ownsTab);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Invalid enabled property.');
    if (input.path !== undefined && (typeof input.path !== 'string' || !input.path || input.path.length > 4096
      || /^[a-z][a-z\d+.-]*:/i.test(input.path) || !resolveExtensionPage(extension.id, input.path))) {
      throw new Error('Side panel path must belong to the calling extension.');
    }
    const previous = this.get(extension, tabId);
    const options: ExtensionPanelOptions = { ...previous,
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      ...(typeof input.path === 'string' ? { path: panelPath(resolveExtensionPage(extension.id, input.path)!) } : {}) };
    const entries = this.options.get(extension.id) ?? new Map<number | null, ExtensionPanelOptions>();
    entries.set(tabId ?? null, options); this.options.set(extension.id, entries);
  }

  togglesOnAction(id: string): boolean { return this.behaviors.get(id) ?? false; }
  setBehavior(id: string, input: Record<string, unknown>): void {
    if (input.openPanelOnActionClick !== undefined && typeof input.openPanelOnActionClick !== 'boolean') throw new Error('Invalid panel behavior.');
    if (typeof input.openPanelOnActionClick === 'boolean') this.behaviors.set(id, input.openPanelOnActionClick);
  }
  tabSpecific(id: string, tabId?: number): boolean { return tabId !== undefined && Boolean(this.options.get(id)?.has(tabId)); }
  forgetTab(tabId: number): void { for (const entries of this.options.values()) entries.delete(tabId); }
  remove(id: string): void { this.options.delete(id); this.behaviors.delete(id); }
}

export function panelTabId(value: unknown, ownsTab: (id: number) => boolean): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || !ownsTab(value)) throw new Error('Browser tab unavailable.');
  return value;
}

export function panelPath(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.slice(1) + parsed.search + parsed.hash;
}
