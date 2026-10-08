import type { ContextMenuParams, Extension, WebContents } from 'electron';
import type { ExtensionSystemEvent } from '../../contracts/extension-api.js';
import type { BrowserMenuEntry } from '../context-menu.js';
import { extensionTabDetails } from './tabs.js';

type MenuItem = { id: string | number; title: string; contexts: string[]; enabled: boolean; visible: boolean };
const CONTEXTS = new Set(['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio']);

export class BrowserExtensionContextMenus {
  private readonly items = new Map<string, Map<string | number, MenuItem>>();
  constructor(private readonly publish: (id: string, event: ExtensionSystemEvent) => void,
    private readonly hasPermission: (id: string) => boolean) {}

  call(extension: Extension, method: string, args: unknown[]): unknown {
    if (!extension.manifest.permissions?.includes('contextMenus')) throw new Error('contextMenus permission required.');
    if (method === 'removeAll') { this.remove(extension.id); return; }
    const items = this.items.get(extension.id) ?? new Map<string | number, MenuItem>();
    if (method === 'remove') { if (!items.delete(args[0] as string | number)) throw new Error('Menu item unavailable.'); return; }
    const input = (method === 'create' ? args[0] : args[1]) as Partial<MenuItem> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid menu item.');
    if (Object.keys(input).some((key) => !['id', 'title', 'contexts', 'enabled', 'visible'].includes(key))) throw new Error('Unsupported menu item properties.');
    const id = method === 'create' ? input.id : args[0];
    if ((typeof id !== 'string' || !id.length || id.length > 256) && (typeof id !== 'number' || !Number.isSafeInteger(id))) throw new Error('Invalid menu item ID.');
    if (!['create', 'update'].includes(method)) throw new Error('Unsupported context menu operation.');
    if (method === 'create' && items.has(id)) throw new Error('Duplicate menu item ID.');
    const current = items.get(id);
    if (method === 'update' && !current) throw new Error('Menu item unavailable.');
    const next = { id, title: '', contexts: ['page'], enabled: true, visible: true, ...current, ...input };
    if (typeof next.title !== 'string' || !next.title || next.title.length > 4096 || !Array.isArray(next.contexts)
      || !next.contexts.length || next.contexts.some((context) => !CONTEXTS.has(context))
      || typeof next.enabled !== 'boolean' || typeof next.visible !== 'boolean') throw new Error('Invalid menu item properties.');
    items.set(id, next); this.items.set(extension.id, items);
    return;
  }

  entries(contents: WebContents, params: ContextMenuParams, windowId: number): BrowserMenuEntry[] {
    const contexts = new Set(['all', 'page', ...(params.selectionText ? ['selection'] : []), ...(params.linkURL ? ['link'] : []),
      ...(params.isEditable ? ['editable'] : []), ...(params.mediaType !== 'none' ? [params.mediaType] : []), ...(params.frameURL !== params.pageURL ? ['frame'] : [])]);
    const entries: BrowserMenuEntry[] = [];
    for (const [extensionId, items] of this.items) {
      if (!this.hasPermission(extensionId)) continue;
      for (const item of items.values()) {
        if (!item.visible || !item.contexts.some((context) => contexts.has(context))) continue;
        entries.push({ label: item.title.replace(/%s/g, params.selectionText), enabled: item.enabled, click: () => {
          if (contents.isDestroyed() || !this.hasPermission(extensionId) || this.items.get(extensionId)?.get(item.id) !== item) return;
          this.publish(extensionId, { kind: 'contextMenuClicked',
            info: { menuItemId: item.id, pageUrl: params.pageURL, frameUrl: params.frameURL,
              ...(params.linkURL ? { linkUrl: params.linkURL } : {}), ...(params.selectionText ? { selectionText: params.selectionText } : {}),
              ...(params.srcURL ? { srcUrl: params.srcURL, mediaType: params.mediaType } : {}), editable: params.isEditable },
            tab: extensionTabDetails(contents, 'complete', undefined, windowId) });
        } });
      }
    }
    return entries;
  }

  remove(id: string): void { this.items.delete(id); }
  dispose(): void { this.items.clear(); }
}
