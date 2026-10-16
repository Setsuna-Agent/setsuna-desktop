import type { BrowserWindow } from 'electron';

type WindowListener = (window: BrowserWindow) => (() => void) | void;
type WindowEntry = {
  window: BrowserWindow;
  initialThreadId: string | null;
  sessionKey: string;
  disposers: Set<() => void>;
};

/** Only app-created desktop windows enter this registry; webview guests never do. */
export class DesktopWindowRegistry {
  private readonly entries = new Map<number, WindowEntry>();
  private readonly listeners = new Set<(entry: WindowEntry) => void>();

  add(window: BrowserWindow, initialThreadId: string | null = null): void {
    const senderId = window.webContents.id;
    if (this.entries.has(senderId)) return;
    // Reopening a window reuses its recovery slot; simultaneous windows never
    // share drafts, browser IDs or panel state, even for the same conversation.
    const base = initialThreadId ? `thread:${encodeURIComponent(initialThreadId)}` : 'primary';
    const occupied = new Set([...this.entries.values()].map((entry) => entry.sessionKey));
    let slot = 0;
    while (occupied.has(`${base}:${slot}`)) slot += 1;
    const entry: WindowEntry = { window, initialThreadId, sessionKey: `${base}:${slot}`, disposers: new Set() };
    this.entries.set(senderId, entry);
    // One native listener owns all registry subscriptions; unsubscribe removes
    // their callbacks too, so service restarts cannot accumulate closed listeners.
    window.once('closed', () => {
      this.entries.delete(senderId);
      if (!this.entries.size) this.listeners.clear();
      for (const dispose of [...entry.disposers]) dispose();
    });
    for (const listener of this.listeners) listener(entry);
  }

  get(senderId: number): BrowserWindow | null {
    const window = this.entries.get(senderId)?.window;
    return window && !window.isDestroyed() ? window : null;
  }

  all(): BrowserWindow[] {
    return [...this.entries.values()].map(({ window }) => window).filter((window) => !window.isDestroyed());
  }

  sessionContext(senderId: number): { initialThreadId: string | null; sessionKey: string } | null {
    const entry = this.entries.get(senderId);
    return entry ? { initialThreadId: entry.initialThreadId, sessionKey: entry.sessionKey } : null;
  }

  onWindowAdded(listener: WindowListener): () => void {
    const disposers = new Set<() => void>();
    const attach = (entry: WindowEntry) => {
      const dispose = listener(entry.window);
      if (!dispose) return;
      const cleanup = () => {
        if (!disposers.delete(cleanup)) return;
        entry.disposers.delete(cleanup);
        dispose();
      };
      disposers.add(cleanup);
      entry.disposers.add(cleanup);
    };
    this.listeners.add(attach);
    for (const entry of this.entries.values()) if (!entry.window.isDestroyed()) attach(entry);
    return () => {
      this.listeners.delete(attach);
      for (const dispose of [...disposers]) dispose();
    };
  }

  publish(channel: string, payload: unknown): void {
    for (const window of this.all()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    }
  }
}

export const desktopWindows = new DesktopWindowRegistry();
