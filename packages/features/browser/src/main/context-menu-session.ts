import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { BrowserContextMenuRequest } from '../contracts/index.js';
import type { BrowserMenuEntry } from './context-menu.js';

/** Only the current menu's opaque action IDs cross the renderer bridge. */
export class BrowserContextMenuSession {
  private active: { id: string; guest: WebContents; actions: Map<string, () => void>; dispose(): void } | null = null;

  constructor(private readonly publish: (request: BrowserContextMenuRequest | null) => void) {}

  show(guest: WebContents, entries: BrowserMenuEntry[], point: { x: number; y: number }): boolean {
    this.dismiss();
    if (guest.isDestroyed()) return false;
    const id = randomUUID();
    const actions = new Map<string, () => void>();
    const items = entries.map((entry, index) => {
      const key = String(index);
      if (entry.type === 'separator') return { key, type: 'divider' as const };
      if (entry.enabled !== false && entry.click) actions.set(key, entry.click);
      return { key, label: entry.label, disabled: entry.enabled === false, shortcut: entry.accelerator };
    });
    const invalidate = () => this.dismiss(id);
    guest.on('did-start-navigation', invalidate);
    guest.on('destroyed', invalidate);
    this.active = { id, guest, actions, dispose: () => {
      guest.off('did-start-navigation', invalidate);
      guest.off('destroyed', invalidate);
    } };
    this.publish({ id, webContentsId: guest.id, ...point, items });
    return true;
  }

  execute(id: string, key: string): boolean {
    const active = this.active;
    const action = active?.id === id ? active.actions.get(key) : undefined;
    if (!active || !action || active.guest.isDestroyed()) return false;
    // Consume before execution: async cache clearing and repeated clicks cannot replay it.
    this.dismiss(id);
    active.guest.focus();
    action();
    return true;
  }

  dismiss(id?: string): void {
    if (!this.active || (id !== undefined && this.active.id !== id)) return;
    this.active.dispose();
    this.active = null;
    this.publish(null);
  }
}
